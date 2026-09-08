import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createTRPCClient } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { grpcLink, type CallContext } from './link.js';
import {
  schemaFromRouter,
  zAsyncIterable,
  type ProtoMeta,
} from '@trpc-proto/schema_ir';

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: {
    proto: {
      package: 'demo.v1',
      syntax: 'proto3',
    },
  },
});

const appRouter = t.router({
  hello: t.procedure
    .input(z.object({ name: z.string() }))
    .output(z.object({ message: z.string() }))
    .query(({ input }) => ({ message: `hello ${input.name}` })),
  events: t.procedure
    .output(zAsyncIterable({ yield: z.object({ message: z.string() }) }))
    .subscription(async function* () {}),
});
type AppRouter = typeof appRouter;
const schema = schemaFromRouter(appRouter);

/** Fixture token for interceptor metadata assertions. */
const TEST_TOKEN = 'secret';

/** gRPC metadata key the auth interceptor writes. */
const AUTH_METADATA_KEY = 'authorization';

/** Authorization scheme prefix the auth interceptor uses. */
const AUTH_SCHEME_BEARER = 'Bearer';

describe('grpcLink', () => {
  it('attaches auth metadata before the stub call', async () => {
    const seen: CallContext[] = [];
    const client = createTRPCClient<AppRouter>({
      links: [
        grpcLink<AppRouter>({
          schema,
          auth: { token: TEST_TOKEN },
          interceptors: [
            async (ctx) => {
              seen.push(ctx);
              ctx.metadata.set('x-trace', '1');
              return { message: `hello Ada` };
            },
          ],
        }),
      ],
    });
    const out = await client.hello.query({ name: 'Ada' });
    assert.deepEqual(out, { message: 'hello Ada' });
    assert.equal(
      seen[0]?.metadata.get(AUTH_METADATA_KEY),
      `${AUTH_SCHEME_BEARER} ${TEST_TOKEN}`,
    );
    assert.equal(seen[0]?.metadata.get('x-trace'), '1');
  });

  it('silently ends an aborted subscription', async () => {
    let signal: AbortSignal | undefined;
    const errors: unknown[] = [];
    const client = createTRPCClient<AppRouter>({
      links: [
        grpcLink<AppRouter>({
          schema,
          interceptors: [
            async (ctx) => {
              signal = ctx.signal;
              return {
                async *[Symbol.asyncIterator]() {
                  const { promise, reject } =
                    Promise.withResolvers<void>();
                  ctx.signal?.addEventListener(
                    'abort',
                    () =>
                      reject(new DOMException('stream aborted', 'AbortError')),
                    { once: true },
                  );
                  await promise;
                },
              };
            },
          ],
        }),
      ],
    });

    const subscription = client.events.subscribe(undefined, {
      onData() {},
      onError(error) {
        errors.push(error);
      },
    });
    await delay(0);
    subscription.unsubscribe();
    await delay(0);

    assert.equal(signal?.aborted, true);
    assert.deepEqual(errors, []);
  });
});
