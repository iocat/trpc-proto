import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';
import { createTRPCClient } from '@trpc/client';
import { initTRPC, TRPCError } from '@trpc/server';
import { schemaFromRouter, type ProtoMeta } from '@trpc-proto/schema_ir';
import { z } from 'zod';
import { serveGrpc } from '../../grpc/server.js';
import { serveGrpcWeb } from '../../web/server.js';
import { grpcWebLink } from '../../web/link.js';
import { protoSchema as batchProtoSchema } from '../proto/generated/schema.js';

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: { proto: { package: 'batch.test.v1' } },
});
let activeWork = 0;
let maxActiveWork = 0;

function resetWorkConcurrency(): void {
  activeWork = 0;
  maxActiveWork = 0;
}

const appRouter = t.router({
  greeting: t.router({
    hello: t.procedure
      .input(z.object({ name: z.string() }))
      .output(z.object({ message: z.string() }))
      .query(({ input }) => ({ message: `hello ${input.name}` })),
    fail: t.procedure
      .input(z.object({}))
      .output(z.object({}))
      .query(() => {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'missing greeting' });
      }),
  }),
  math: t.router({
    double: t.procedure
      .input(z.object({ operand: z.int() }))
      .output(z.object({ doubled: z.int() }))
      .query(({ input }) => ({ doubled: input.operand * 2 })),
  }),
  work: t.router({
    wait: t.procedure
      .input(z.object({ id: z.string() }))
      .output(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        activeWork += 1;
        maxActiveWork = Math.max(maxActiveWork, activeWork);
        try {
          await delay(20);
          return input;
        } finally {
          activeWork -= 1;
        }
      }),
  }),
});

type AppRouter = typeof appRouter;
const appSchema = schemaFromRouter(appRouter);

describe('generated batch protocol', () => {
  it('declares one unary protobuf batch method with bytes payloads', () => {
    assert.deepEqual(batchProtoSchema.services, [
      {
        name: 'BatchService',
        methods: [
          {
            name: 'Execute',
            path: 'batch.execute',
            type: 'mutation',
            requestType: 'BatchRequest',
            responseType: 'BatchResponse',
            isResponseStreaming: false,
          },
        ],
      },
    ]);
    const call = batchProtoSchema.messages.find(
      (message) => message.name === 'BatchCall',
    );
    assert.equal(
      call?.fields.find((field) => field.name === 'input')?.type.kind,
      'scalar',
    );
    assert.equal(
      call?.fields.find((field) => field.name === 'input')?.type.kind ===
        'scalar'
        ? call.fields.find((field) => field.name === 'input')?.type.type
        : undefined,
      'bytes',
    );
  });
});

describe('gRPC-Web batching', () => {
  it('enables direct concurrent batches through grpcWebLink', async () => {
    let contextCalls = 0;
    const server = await serveGrpcWeb({
      mode: 'direct',
      router: appRouter,
      schema: appSchema,
      address: '127.0.0.1:0',
      createContext: () => {
        contextCalls += 1;
        return {};
      },
    });
    try {
      const client = createTRPCClient<AppRouter>({
        links: [
          grpcWebLink<AppRouter>({
            schema: appSchema,
            url: `http://127.0.0.1:${server.port}`,
            encoding: 'raw',
            batch: true,
          }),
        ],
      });

      const [greeting, doubled] = await Promise.all([
        client.greeting.hello.query({ name: 'Ada' }),
        client.math.double.query({ operand: 21 }),
      ]);

      assert.deepEqual(greeting, { message: 'hello Ada' });
      assert.deepEqual(doubled, { doubled: 42 });
      assert.equal(contextCalls, 1);
      resetWorkConcurrency();
      const work = await Promise.all([
        client.work.wait.mutate({ id: 'one' }),
        client.work.wait.mutate({ id: 'two' }),
      ]);
      assert.deepEqual(work, [{ id: 'one' }, { id: 'two' }]);
      assert.equal(maxActiveWork, 2);
      assert.equal(contextCalls, 2);
    } finally {
      await server.close();
    }
  });

  it('keeps an item error isolated from sibling results', async () => {
    const server = await serveGrpcWeb({
      mode: 'direct',
      router: appRouter,
      schema: appSchema,
      address: '127.0.0.1:0',
    });
    try {
      const client = createTRPCClient<AppRouter>({
        links: [
          grpcWebLink<AppRouter>({
            schema: appSchema,
            url: `http://127.0.0.1:${server.port}`,
            encoding: 'base64',
            batch: true,
          }),
        ],
      });

      const results = await Promise.allSettled([
        client.greeting.hello.query({ name: 'Grace' }),
        client.greeting.fail.query({}),
      ]);

      assert.equal(results[0]?.status, 'fulfilled');
      assert.deepEqual(
        results[0]?.status === 'fulfilled' ? results[0].value : undefined,
        { message: 'hello Grace' },
      );
      assert.equal(results[1]?.status, 'rejected');
      assert.match(
        results[1]?.status === 'rejected' ? String(results[1].reason) : '',
        /missing greeting/,
      );
    } finally {
      await server.close();
    }
  });
  it('fans out concurrent batches without backend batch support', async () => {
    const backend = await serveGrpc(appRouter, {
      schema: appSchema,
      address: '127.0.0.1:0',
    });
    const gateway = await serveGrpcWeb({
      mode: 'forward',
      schema: appSchema,
      address: '127.0.0.1:0',
      backend: {
        address: `127.0.0.1:${backend.port}`,
        credentials: { type: 'insecure' },
      },
    });
    try {
      const client = createTRPCClient<AppRouter>({
        links: [
          grpcWebLink<AppRouter>({
            schema: appSchema,
            url: `http://127.0.0.1:${gateway.port}`,
            encoding: 'raw',
            batch: true,
          }),
        ],
      });

      const [greeting, doubled] = await Promise.all([
        client.greeting.hello.query({ name: 'Lin' }),
        client.math.double.query({ operand: 7 }),
      ]);

      assert.deepEqual(greeting, { message: 'hello Lin' });
      assert.deepEqual(doubled, { doubled: 14 });
      resetWorkConcurrency();
      const work = await Promise.all([
        client.work.wait.mutate({ id: 'three' }),
        client.work.wait.mutate({ id: 'four' }),
      ]);
      assert.deepEqual(work, [{ id: 'three' }, { id: 'four' }]);
      assert.equal(maxActiveWork, 2);
    } finally {
      await gateway.close();
      await backend.close();
    }
  });
});
