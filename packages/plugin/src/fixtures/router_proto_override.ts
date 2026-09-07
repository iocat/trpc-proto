import { initTRPC } from '@trpc/server';
import type { ProtoMeta } from '@trpc-proto/schema_ir';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: {
    proto: {
      package: 'demo.v1',
      syntax: 'proto3',
      cache: 'generated/schema.json',
    },
  },
});

export const appRouter = t.router({
  ping: t.procedure
    .meta({
      proto: {
        package: 'other.v1',
        syntax: 'proto3',
      },
    })
    .output(z.object({ ok: z.boolean() }))
    .query(() => ({ ok: true })),
});
