import { initTRPC } from '@trpc/server';
import type { ProtoMeta } from '@trpc-proto/runtime';

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
  ping: t.procedure.query(() => 'pong'),
});
