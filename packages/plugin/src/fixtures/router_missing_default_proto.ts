import { initTRPC } from '@trpc/server';
import type { ProtoMeta } from '@trpc-proto/runtime';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create();

export const appRouter = t.router({
  ping: t.procedure
    .output(z.object({ ok: z.boolean() }))
    .query(() => ({ ok: true })),
});
