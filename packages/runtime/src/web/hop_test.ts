import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import * as grpc from '@grpc/grpc-js';
import { createTRPCClient } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { createGrpcWebHop } from './hop.js';
import { grpcWebProxyLink } from './link.js';
import {
  decodeGrpcWeb,
  encodeGrpcWebMessage,
  GRPC_WEB_CONTENT_TYPE,
} from './protocol.js';
import { serveGrpc } from '../grpc/server.js';
import type { ProtoMeta } from '@trpc-proto/schema_ir';

describe('createGrpcWebHop', () => {
  it('round-trips through a gRPC-Web hop to serveGrpc', async () => {
    const t = initTRPC.meta<ProtoMeta>().create({
      defaultMeta: { proto: { package: 'demo.v1' } },
    });
    const appRouter = t.router({
      hello: t.procedure
        .input(z.object({ name: z.string() }))
        .output(z.object({ message: z.string() }))
        .query(({ input }) => ({ message: `hello ${input.name}` })),
    });
    type AppRouter = typeof appRouter;
    const grpcServer = await serveGrpc(appRouter, { address: '127.0.0.1:0' });
    const proxy = createGrpcWebHop(`127.0.0.1:${grpcServer.port}`);
    const server = http.createServer(async (req, res) => {
      if (!(await proxy.handle(req, res))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as { port: number };
    try {
      const client = createTRPCClient<AppRouter>({
        links: [
          grpcWebProxyLink({
            router: appRouter,
            url: `http://127.0.0.1:${port}`,
          }),
        ],
      });
      const out = await client.hello.query({ name: 'Ada' });
      assert.deepEqual(out, { message: 'hello Ada' });
    } finally {
      server.close();
      await grpcServer.close();
    }
  });

  it('forwards request metadata and grpc-status trailers', async () => {
    const backend = new grpc.Server();
    let seenAuth = '';
    let seenTrace = '';
    backend.addService(
      {
        Hello: {
          path: '/demo.v1.AppService/Hello',
          requestStream: false,
          responseStream: false,
          requestSerialize: (value: Buffer) => value,
          requestDeserialize: (value: Buffer) => value,
          responseSerialize: (value: Buffer) => value,
          responseDeserialize: (value: Buffer) => value,
        },
      },
      {
        Hello(
          call: grpc.ServerUnaryCall<Buffer, Buffer>,
          callback: grpc.sendUnaryData<Buffer>,
        ) {
          seenAuth = String(call.metadata.get('authorization')[0] ?? '');
          seenTrace = String(call.metadata.get('x-trace')[0] ?? '');
          const metadata = new grpc.Metadata();
          metadata.set('x-error-id', 'e1');
          callback({
            name: 'Error',
            message: 'no such user',
            code: grpc.status.NOT_FOUND,
            details: 'no such user',
            metadata,
          });
        },
      },
    );
    const port = await new Promise<number>((resolve, reject) => {
      backend.bindAsync(
        '127.0.0.1:0',
        grpc.ServerCredentials.createInsecure(),
        (err, bound) => (err ? reject(err) : resolve(bound)),
      );
    });
    const proxy = createGrpcWebHop(`127.0.0.1:${port}`);
    const server = http.createServer(async (req, res) => {
      if (!(await proxy.handle(req, res))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port: webPort } = server.address() as { port: number };
    try {
      const res = await fetch(
        `http://127.0.0.1:${webPort}/demo.v1.AppService/Hello`,
        {
          method: 'POST',
          headers: {
            'content-type': GRPC_WEB_CONTENT_TYPE,
            authorization: 'Bearer secret',
            'x-trace': 'abc',
            'x-grpc-web': '1',
          },
          body: Buffer.from(encodeGrpcWebMessage(new Uint8Array([1]))),
        },
      );
      assert.equal(res.status, 200);
      const decoded = decodeGrpcWeb(new Uint8Array(await res.arrayBuffer()));
      assert.equal(seenAuth, 'Bearer secret');
      assert.equal(seenTrace, 'abc');
      assert.equal(decoded.trailers['grpc-status'], '5');
      assert.equal(decoded.trailers['grpc-message'], 'no such user');
      assert.equal(decoded.trailers['x-error-id'], 'e1');
    } finally {
      server.close();
      backend.forceShutdown();
    }
  });
});
