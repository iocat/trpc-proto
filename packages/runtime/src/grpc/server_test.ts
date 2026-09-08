import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import {
  bindRouter,
  createGrpcStubCall,
  createProtoStub,
  serveGrpc,
} from './server.js';
import { schemaFromRouter, type ProtoMeta } from '@trpc-proto/schema_ir';

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
    const stubs = bindRouter(router, { schema: schemaFromRouter(router) });
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
    const schema = schemaFromRouter(router);
    const server = await serveGrpc(router, {
      schema,
      address: '127.0.0.1:0',
    });
    try {
      const stub = createProtoStub({
        schema,
        address: `127.0.0.1:${server.port}`,
      });
      const out = await stub.AppService.Hello({ name: 'Ada' });
      assert.deepEqual(out, { message: 'hello Ada' });
    } finally {
      await server.close();
    }
  });

  it('streams subscription values', async () => {
    const t = initTRPC.meta<ProtoMeta>().create({
      defaultMeta: { proto: { package: 'demo.v1' } },
    });
    const router = t.router({
      ticks: t.procedure
        .output(z.object({ n: z.int() }))
        .subscription(async function* () {
          yield { n: 1 };
          yield { n: 2 };
        }),
    });
    const schema = schemaFromRouter(router);
    const server = await serveGrpc(router, {
      schema,
      address: '127.0.0.1:0',
    });
    const call = createGrpcStubCall({
      schema,
      address: `127.0.0.1:${server.port}`,
    });
    const seen: number[] = [];
    try {
      const result = await call({
        path: 'ticks',
        type: 'subscription',
        input: undefined,
      });
      if (
        result == null ||
        typeof result !== 'object' ||
        !(Symbol.asyncIterator in result)
      ) {
        throw new Error('expected async iterable');
      }
      for await (const item of result) {
        if (
          item &&
          typeof item === 'object' &&
          'n' in item &&
          typeof item.n === 'number'
        ) {
          seen.push(item.n);
        }
      }
      assert.deepEqual(seen, [1, 2]);
    } finally {
      await server.close();
    }
  });
});
