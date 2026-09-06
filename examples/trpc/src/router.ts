import { initTRPC, TRPCError } from '@trpc/server';
import { createProtoTransformer, type ProtoMeta } from '@trpc-proto/runtime';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  transformer: createProtoTransformer(),
  defaultMeta: {
    proto: {
      package: 'trpc.v1',
      cache: 'generated/schema.json',
    },
  },
});

const Note = z
  .object({
    id: z.string(),
    body: z.string(),
  })
  .meta({ id: 'Note' });

const notes = new Map<string, z.infer<typeof Note>>();

export const appRouter = t.router({
  health: t.procedure
    .output(z.object({ ok: z.boolean() }))
    .query(() => ({ ok: true })),

  echo: t.procedure
    .input(z.string())
    .output(z.string())
    .query(({ input }) => input),

  note: t.router({
    put: t.procedure
      .input(Note)
      .output(Note)
      .mutation(({ input }) => {
        notes.set(input.id, input);
        return input;
      }),

    get: t.procedure
      .input(z.object({ id: z.string() }))
      .output(Note)
      .query(({ input }) => {
        const note = notes.get(input.id);
        if (!note) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `note "${input.id}" not found`,
          });
        }
        return note;
      }),
  }),
});

export type AppRouter = typeof appRouter;
