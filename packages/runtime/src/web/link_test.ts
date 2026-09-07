import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTRPCClient } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { grpcWebLink } from './link.js';
import type { ProtoMeta } from '@trpc-proto/schema_ir';

describe('grpcWebLink', () => {
  it('uses grpcWebLink on createTRPCClient', async () => {
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
    const client = createTRPCClient<AppRouter>({
      links: [
        grpcWebLink({
          router: appRouter,
          interceptors: [async () => ({ message: 'hello Ada' })],
        }),
      ],
    });
    const out = await client.hello.query({ name: 'Ada' });
    assert.deepEqual(out, { message: 'hello Ada' });
  });
});
