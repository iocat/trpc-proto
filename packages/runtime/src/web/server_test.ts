import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';
import { createTRPCClient } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import {
  schemaFromRouter,
  zAsyncIterable,
  type ProtoMeta,
} from '@trpc-proto/schema_ir';
import { z } from 'zod';
import { serveGrpc } from '../grpc/server.js';
import { createGrpcWebFetchCall } from './fetch_call.js';
import { grpcWebLink } from './link.js';
import { serveGrpcWeb } from './server.js';

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: { proto: { package: 'direct.v1' } },
});

describe('serveGrpcWeb', () => {
  it('dispatches unary and streaming procedures directly', async () => {
    const appRouter = t.router({
      echo: t.procedure
        .input(z.object({ value: z.string(), suffix: z.string() }))
        .output(z.object({ message: z.string(), length: z.int() }))
        .query(({ input }) => ({
          message: `${input.value}${input.suffix}`,
          length: input.value.length + input.suffix.length,
        })),
      count: t.procedure
        .input(z.object({ end: z.int() }))
        .output(
          zAsyncIterable({
            yield: z.object({ value: z.int(), squared: z.int() }),
          }),
        )
        .subscription(async function* ({ input }) {
          for (let value = 1; value <= input.end; value += 1) {
            yield { value, squared: value * value };
          }
        }),
    });
    type AppRouter = typeof appRouter;
    const schema = schemaFromRouter(appRouter);
    const server = await serveGrpcWeb({
      mode: 'direct',
      router: appRouter,
      schema,
      address: '127.0.0.1:0',
    });

    try {
      for (const encoding of ['raw', 'base64'] as const) {
        for (const compress of [false, true]) {
          const client = createTRPCClient<AppRouter>({
            links: [
              grpcWebLink<AppRouter>({
                schema,
                url: `http://${server.address}`,
                encoding,
                compress,
              }),
            ],
          });
          assert.deepEqual(
            await client.echo.query({ value: 'hello', suffix: '!' }),
            { message: 'hello!', length: 6 },
          );
        }
      }

      const client = createTRPCClient<AppRouter>({
        links: [
          grpcWebLink<AppRouter>({
            schema,
            url: `http://${server.address}`,
            encoding: 'base64',
          }),
        ],
      });
      const values: number[] = [];
      const completed = Promise.withResolvers<void>();
      client.count.subscribe(
        { end: 3 },
        {
          onData(value) {
            values.push(value.value);
          },
          onError: completed.reject,
          onComplete: completed.resolve,
        },
      );
      await completed.promise;
      assert.deepEqual(values, [1, 2, 3]);
    } finally {
      await server.close();
    }

    await assert.rejects(fetch(`http://${server.address}`));
  });

  it('forwards to a separately hosted native gRPC server', async () => {
    const appRouter = t.router({
      hello: t.procedure
        .input(z.object({ name: z.string() }))
        .output(z.object({ message: z.string() }))
        .query(({ input }) => ({ message: `hello ${input.name}` })),
    });
    type AppRouter = typeof appRouter;
    const schema = schemaFromRouter(appRouter);
    const backend = await serveGrpc(appRouter, {
      schema,
      address: '127.0.0.1:0',
    });
    const server = await serveGrpcWeb({
      mode: 'forward',
      backend: { address: backend.address },
      address: '127.0.0.1:0',
    });

    try {
      const client = createTRPCClient<AppRouter>({
        links: [
          grpcWebLink<AppRouter>({
            schema,
            url: `http://${server.address}`,
            encoding: 'raw',
          }),
        ],
      });
      assert.deepEqual(await client.hello.query({ name: 'Ada' }), {
        message: 'hello Ada',
      });
    } finally {
      await server.close();
      await backend.close();
    }
  });

  it('propagates browser cancellation to the router procedure', async () => {
    const cancelled = Promise.withResolvers<void>();
    const appRouter = t.router({
      watch: t.procedure
        .input(z.object({}))
        .output(zAsyncIterable({ yield: z.object({ value: z.int() }) }))
        .subscription(async function* ({ signal }) {
          yield { value: 1 };
          await new Promise<void>((resolve) => {
            signal?.addEventListener(
              'abort',
              () => {
                cancelled.resolve();
                resolve();
              },
              { once: true },
            );
          });
        }),
    });
    const schema = schemaFromRouter(appRouter);
    const server = await serveGrpcWeb({
      mode: 'direct',
      router: appRouter,
      schema,
      address: '127.0.0.1:0',
    });

    try {
      const controller = new AbortController();
      const call = createGrpcWebFetchCall({
        baseUrl: `http://${server.address}`,
        encoding: 'raw',
      });
      const response = await call({
        path: 'watch',
        type: 'subscription',
        input: {},
        bytes: new Uint8Array(),
        grpcPath: '/direct.v1.AppService/Watch',
        signal: controller.signal,
      });
      if (
        response === null ||
        typeof response !== 'object' ||
        !(Symbol.asyncIterator in response)
      ) {
        assert.fail('expected streaming response');
      }
      const iterator = response[Symbol.asyncIterator]();
      assert.deepEqual(await iterator.next(), {
        done: false,
        value: new Uint8Array([8, 1]),
      });
      controller.abort();
      await Promise.race([
        cancelled.promise,
        delay(1_000).then(() =>
          assert.fail('router procedure was not cancelled'),
        ),
      ]);
    } finally {
      await server.close();
    }
  });
});
