import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { bindRouter } from './bind.js';
import { createProtoStub, serveGrpc } from './grpc.js';
import type { ProtoMeta } from '@trpc-proto/schema_ir';

describe('bindRouter', () => {
  it('calls tRPC procedures by proto service method', async () => {
    const t = initTRPC.meta<ProtoMeta>().create({
      defaultMeta: { proto: { package: 'demo.v1' } },
    });
    const router = t.router({
      hello: t.procedure
        .input(z.object({ name: z.string() }))
        .output(z.object({ message: z.string() }))
        .query(({ input }) => ({ message: `hello ${input.name}` })),
    });
    const stubs = bindRouter(router);
    const out = await stubs.AppService.Hello({ name: 'Ada' });
    assert.deepEqual(out, { message: 'hello Ada' });
  });
});

describe('serveGrpc', () => {
  it('serves a tRPC router over protobuf gRPC', async () => {
    const t = initTRPC.meta<ProtoMeta>().create({
      defaultMeta: { proto: { package: 'demo.v1' } },
    });
    const router = t.router({
      hello: t.procedure
        .input(z.object({ name: z.string() }))
        .output(z.object({ message: z.string() }))
        .query(({ input }) => ({ message: `hello ${input.name}` })),
    });
    const server = await serveGrpc(router, { address: '127.0.0.1:0' });
    try {
      const stub = createProtoStub({
        router,
        address: `127.0.0.1:${server.port}`,
      });
      const out = await stub.AppService.Hello({ name: 'Ada' });
      assert.deepEqual(out, { message: 'hello Ada' });
    } finally {
      await server.close();
    }
  });
});
