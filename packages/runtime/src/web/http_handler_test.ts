import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';
import * as grpc from '@grpc/grpc-js';
import { createTRPCClient } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { createForwardingGrpcWebHttpHandler } from './http_handler.js';
import { grpcWebLink } from './link.js';
import { GrpcWebFrameCodec, type GrpcWebFrame } from './codec/frame_codec.js';
import {
  GrpcWebProtocolCodec,
  type GrpcWebProtocolValue,
} from './codec/protocol_codec.js';
import {
  GRPC_WEB_CONTENT_TYPE,
  GRPC_WEB_TEXT_CONTENT_TYPE,
} from './content_type.js';
import { createGrpcWebFetchCall } from './fetch_call.js';
import { serveGrpc } from '../grpc/server.js';
import {
  schemaFromRouter,
  zAsyncIterable,
  type ProtoMeta,
} from '@trpc-proto/schema_ir';
const frameCodec = new GrpcWebFrameCodec();
const protocolCodec = new GrpcWebProtocolCodec();
async function decodeProtocol(
  body: Uint8Array,
  encoding: 'raw' | 'base64',
  compression?: string | null,
): Promise<GrpcWebProtocolValue[]> {
  const values: GrpcWebProtocolValue[] = [];
  for await (const value of protocolCodec.decode(body, {
    encoding,
    compression,
  })) {
    values.push(value);
  }
  return values;
}
const forwardingT = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: { proto: { package: 'demo.v1' } },
});
const forwardingSchema = schemaFromRouter(
  forwardingT.router({
    hello: forwardingT.procedure
      .input(z.object({}))
      .output(z.object({}))
      .query(() => ({})),
    watch: forwardingT.procedure
      .input(z.object({}))
      .output(zAsyncIterable({ yield: z.object({}) }))
      .subscription(async function* () {}),
  }),
);

describe('createForwardingGrpcWebHttpHandler', () => {
  it('round-trips through a gRPC-Web HTTP handler to serveGrpc', async () => {
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
    const schema = schemaFromRouter(appRouter);
    const grpcServer = await serveGrpc(appRouter, {
      schema,
      address: '127.0.0.1:0',
    });
    const handleGrpcWeb = createForwardingGrpcWebHttpHandler({
      address: `127.0.0.1:${grpcServer.port}`,
      schema,
    });
    let requestContentType = '';
    let requestCompression = '';
    const server = http.createServer(async (req, res) => {
      requestContentType = String(req.headers['content-type'] ?? '');
      requestCompression = String(req.headers['grpc-encoding'] ?? '');
      if (!(await handleGrpcWeb(req, res))) {
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
          grpcWebLink<AppRouter>({
            schema,
            url: `http://127.0.0.1:${port}`,
            encoding: 'base64',
            compress: true,
          }),
        ],
      });
      const out = await client.hello.query({ name: 'Ada' });
      assert.deepEqual(out, { message: 'hello Ada' });
      assert.equal(requestContentType, GRPC_WEB_TEXT_CONTENT_TYPE);
      assert.equal(requestCompression, 'gzip');
    } finally {
      server.close();
      await grpcServer.close();
    }
  });

  it('validates CORS preflight origin, method, and headers', async () => {
    const handleGrpcWeb = createForwardingGrpcWebHttpHandler({
      schema: forwardingSchema,
      cors: {
        allowedOrigins: ['https://app.example'],
        additionalAllowedHeaders: ['x-trace'],
      },
    });
    const server = http.createServer(async (req, res) => {
      if (!(await handleGrpcWeb(req, res))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as { port: number };
    const url = `http://127.0.0.1:${port}/demo.v1.AppService/Hello`;
    const cases = [
      {
        name: 'allowed',
        origin: 'https://app.example',
        method: 'POST',
        headers:
          'content-type, authorization, grpc-accept-encoding, grpc-encoding, x-trace',
        status: 204,
      },
      {
        name: 'denied origin',
        origin: 'https://evil.example',
        method: 'POST',
        headers: 'content-type',
        status: 403,
      },
      {
        name: 'denied method',
        origin: 'https://app.example',
        method: 'GET',
        headers: 'content-type',
        status: 405,
      },
      {
        name: 'denied header',
        origin: 'https://app.example',
        method: 'POST',
        headers: 'content-type, x-denied',
        status: 403,
      },
    ];

    try {
      for (const row of cases) {
        const res = await fetch(url, {
          method: 'OPTIONS',
          headers: {
            origin: row.origin,
            'access-control-request-method': row.method,
            'access-control-request-headers': row.headers,
          },
        });
        assert.equal(res.status, row.status, row.name);
        if (row.status === 204) {
          assert.equal(
            res.headers.get('access-control-allow-origin'),
            row.origin,
          );
          assert.equal(res.headers.get('access-control-allow-methods'), 'POST');
          assert.match(
            res.headers.get('access-control-allow-headers') ?? '',
            /\bx-trace\b/,
          );
          assert.equal(res.headers.get('access-control-max-age'), '600');
          assert.equal(res.headers.get('content-type'), null);
        }
        if (row.name === 'denied origin') {
          assert.equal(res.headers.get('access-control-allow-origin'), null);
        }
      }
    } finally {
      server.close();
    }
  });

  it('negotiates gzip streaming responses without reordering messages', async () => {
    const backend = new grpc.Server();
    backend.addService(
      {
        Watch: {
          path: '/demo.v1.AppService/Watch',
          requestStream: false,
          responseStream: true,
          requestSerialize: (value: Buffer) => value,
          requestDeserialize: (value: Buffer) => value,
          responseSerialize: (value: Buffer) => value,
          responseDeserialize: (value: Buffer) => value,
        },
      },
      {
        Watch(call: grpc.ServerWritableStream<Buffer, Buffer>) {
          call.write(Buffer.from([1]));
          call.write(Buffer.from([2, 3]));
          call.end();
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
    const handleGrpcWeb = createForwardingGrpcWebHttpHandler({
      address: `127.0.0.1:${port}`,
      schema: forwardingSchema,
    });
    const server = http.createServer(async (req, res) => {
      if (!(await handleGrpcWeb(req, res))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port: webPort } = server.address() as { port: number };

    try {
      const requestBody = await protocolCodec.encode(
        { kind: 'message', payload: new Uint8Array([0]) },
        { encoding: 'raw' },
      );
      const response = await fetch(
        `http://127.0.0.1:${webPort}/demo.v1.AppService/Watch`,
        {
          method: 'POST',
          headers: {
            accept: GRPC_WEB_CONTENT_TYPE,
            'content-type': GRPC_WEB_CONTENT_TYPE,
            'grpc-accept-encoding': 'identity, gzip',
            'x-grpc-web': '1',
          },
          body: requestBody,
        },
      );
      const compression = response.headers.get('grpc-encoding');
      const body = new Uint8Array(await response.arrayBuffer());
      const frames: GrpcWebFrame[] = [];
      for await (const frame of frameCodec.decode(body)) frames.push(frame);
      const messageFrames = frames.filter((frame) => frame.kind === 'message');

      assert.equal(compression, 'gzip');
      assert.deepEqual(
        messageFrames.map((frame) => frame.compressed),
        [true, true],
      );
      const values = await decodeProtocol(body, 'raw', compression);
      assert.deepEqual(
        values
          .filter((value) => value.kind === 'message')
          .map((value) => [...value.payload]),
        [[1], [2, 3]],
      );

      const identityResponse = await fetch(
        `http://127.0.0.1:${webPort}/demo.v1.AppService/Watch`,
        {
          method: 'POST',
          headers: {
            accept: GRPC_WEB_CONTENT_TYPE,
            'content-type': GRPC_WEB_CONTENT_TYPE,
            'x-grpc-web': '1',
          },
          body: requestBody,
        },
      );
      assert.equal(identityResponse.headers.get('grpc-encoding'), null);
      const identityFrames: GrpcWebFrame[] = [];
      for await (const frame of frameCodec.decode(
        new Uint8Array(await identityResponse.arrayBuffer()),
      )) {
        identityFrames.push(frame);
      }
      assert.deepEqual(
        identityFrames
          .filter((frame) => frame.kind === 'message')
          .map((frame) => frame.compressed),
        [false, false],
      );
    } finally {
      server.close();
      backend.forceShutdown();
    }
  });

  it('cancels the backend gRPC stream when the browser response closes', async () => {
    const cancelled = Promise.withResolvers<void>();
    const backend = new grpc.Server();
    backend.addService(
      {
        Watch: {
          path: '/demo.v1.AppService/Watch',
          requestStream: false,
          responseStream: true,
          requestSerialize: (value: Buffer) => value,
          requestDeserialize: (value: Buffer) => value,
          responseSerialize: (value: Buffer) => value,
          responseDeserialize: (value: Buffer) => value,
        },
      },
      {
        Watch(call: grpc.ServerWritableStream<Buffer, Buffer>) {
          call.on('cancelled', cancelled.resolve);
          call.write(Buffer.from([1]));
        },
      },
    );
    const bound = Promise.withResolvers<number>();
    backend.bindAsync(
      '127.0.0.1:0',
      grpc.ServerCredentials.createInsecure(),
      (error, port) => {
        if (error) bound.reject(error);
        else bound.resolve(port);
      },
    );
    const backendPort = await bound.promise;
    const handleGrpcWeb = createForwardingGrpcWebHttpHandler({
      address: `127.0.0.1:${backendPort}`,
      schema: forwardingSchema,
    });
    const server = http.createServer(async (req, res) => {
      if (!(await handleGrpcWeb(req, res))) {
        res.writeHead(404);
        res.end();
      }
    });
    const listening = Promise.withResolvers<void>();
    server.listen(0, '127.0.0.1', listening.resolve);
    await listening.promise;
    const { port: webPort } = server.address() as { port: number };

    try {
      const controller = new AbortController();
      const call = createGrpcWebFetchCall({
        baseUrl: `http://127.0.0.1:${webPort}`,
        encoding: 'raw',
      });
      const response = await call({
        path: 'watch',
        type: 'subscription',
        input: undefined,
        bytes: new Uint8Array([0]),
        grpcPath: '/demo.v1.AppService/Watch',
        signal: controller.signal,
      });
      assert.equal(Symbol.asyncIterator in Object(response), true);

      controller.abort();
      await Promise.race([
        cancelled.promise,
        delay(1_000).then(() =>
          assert.fail('backend gRPC stream was not cancelled'),
        ),
      ]);
    } finally {
      server.close();
      backend.forceShutdown();
    }
  });

  it('forwards request metadata and grpc-status trailers', async () => {
    const backend = new grpc.Server();
    let calls = 0;
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
          calls += 1;
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
    const handleGrpcWeb = createForwardingGrpcWebHttpHandler({
      address: `127.0.0.1:${port}`,
      schema: forwardingSchema,
      cors: {
        allowedOrigins: ['https://app.example'],
        additionalAllowedHeaders: ['x-trace'],
      },
    });
    const server = http.createServer(async (req, res) => {
      if (!(await handleGrpcWeb(req, res))) {
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
            origin: 'https://app.example',
            'content-type': GRPC_WEB_CONTENT_TYPE,
            authorization: 'Bearer secret',
            'x-trace': 'abc',
            'x-grpc-web': '1',
          },
          body: Buffer.from(
            await protocolCodec.encode(
              { kind: 'message', payload: new Uint8Array([1]) },
              { encoding: 'raw' },
            ),
          ),
        },
      );
      assert.equal(res.status, 200);
      assert.equal(
        res.headers.get('access-control-allow-origin'),
        'https://app.example',
      );
      assert.equal(
        res.headers.get('access-control-expose-headers'),
        'grpc-status, grpc-message, grpc-accept-encoding, grpc-encoding, x-grpc-web',
      );
      const decoded = await decodeProtocol(
        new Uint8Array(await res.arrayBuffer()),
        'raw',
      );
      assert.equal(seenAuth, 'Bearer secret');
      assert.equal(seenTrace, 'abc');
      const trailers = decoded.find((value) => value.kind === 'trailers');
      assert.equal(trailers?.status, 5);
      assert.equal(trailers?.message, 'no such user');
      assert.equal(trailers?.metadata?.['x-error-id'], 'e1');
      const denied = await fetch(
        `http://127.0.0.1:${webPort}/demo.v1.AppService/Hello`,
        {
          method: 'POST',
          headers: {
            'content-type': GRPC_WEB_CONTENT_TYPE,
            origin: 'https://evil.example',
            'x-grpc-web': '1',
          },
          body: Buffer.from(
            await protocolCodec.encode(
              { kind: 'message', payload: new Uint8Array([1]) },
              { encoding: 'raw' },
            ),
          ),
        },
      );
      assert.equal(denied.status, 403);
      assert.equal(calls, 1);
    } finally {
      server.close();
      backend.forceShutdown();
    }
  });

  it('rejects malformed requests and negotiates base64 errors', async () => {
    const handleGrpcWeb = createForwardingGrpcWebHttpHandler({
      schema: forwardingSchema,
    });
    const server = http.createServer(async (req, res) => {
      if (!(await handleGrpcWeb(req, res))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      assert.equal((await fetch(baseUrl)).status, 404);
      assert.equal(
        (
          await fetch(`${baseUrl}/demo.v1.AppService/Hello`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
          })
        ).status,
        404,
      );

      const compressedFrame = frameCodec.encode({
        kind: 'message',
        compressed: true,
        payload: new Uint8Array([0x1f, 0x8b, 0x00]),
      });
      const response = await fetch(`${baseUrl}/demo.v1.AppService/Hello`, {
        method: 'POST',
        headers: {
          accept: GRPC_WEB_TEXT_CONTENT_TYPE,
          'content-type': GRPC_WEB_CONTENT_TYPE,
          'x-grpc-web': '1',
        },
        body: compressedFrame,
      });
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get('content-type'),
        GRPC_WEB_TEXT_CONTENT_TYPE,
      );
      assert.equal(response.headers.get('grpc-accept-encoding'), 'gzip');
      const decoded = await decodeProtocol(
        new Uint8Array(await response.arrayBuffer()),
        'base64',
      );
      const trailers = decoded.find((value) => value.kind === 'trailers');
      assert.equal(trailers?.status, 13);
      assert.match(
        trailers?.message ?? '',
        /unsupported grpc-encoding.*identity/,
      );
    } finally {
      server.close();
    }
  });
});
