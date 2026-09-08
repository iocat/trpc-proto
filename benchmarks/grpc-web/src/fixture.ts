import { initTRPC } from '@trpc/server';
import { zAsyncIterable, type ProtoMeta } from '@trpc-proto/runtime';
import { schemaFromRouter } from '@trpc-proto/schema_ir';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: { proto: { package: 'benchmark.v1' } },
});

const Payload = z.object({
  sequence: z.int(),
  payload: z.string(),
});

export const appRouter = t.router({
  echo: t.procedure
    .input(Payload)
    .output(Payload)
    .query(({ input }) => input),
  stream: t.procedure
    .input(z.object({ messages: z.int(), payload: z.string() }))
    .output(zAsyncIterable({ yield: Payload }))
    .subscription(async function* ({ input }) {
      for (let sequence = 0; sequence < input.messages; sequence += 1) {
        yield { sequence, payload: input.payload };
      }
    }),
});

export type AppRouter = typeof appRouter;
export const schema = schemaFromRouter(appRouter);
