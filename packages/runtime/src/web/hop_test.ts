import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { createTRPCClient } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { createGrpcWebHop } from './hop.js';
import { grpcWebProxyLink } from './link.js';
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
    const grpc = await serveGrpc(appRouter, { address: '127.0.0.1:0' });
    const proxy = createGrpcWebHop(`127.0.0.1:${grpc.port}`);
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
      await grpc.close();
    }
  });
});
