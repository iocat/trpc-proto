import { initTRPC, TRPCError } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { createProtoTransformer } from '@trpc-proto/runtime/proto_codec';
import type { ProtoMeta } from '@trpc-proto/runtime';
import { z } from 'zod';
const t = initTRPC.meta<ProtoMeta>().create({
  allowOutsideOfServer: true,
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
const noteListeners = new Set<(note: z.infer<typeof Note>) => void>();

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
        for (const push of noteListeners) push(input);
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

    onChange: t.procedure
      .input(z.object({}))
      .output(Note)
      .subscription((({ signal }: { signal?: AbortSignal }) =>
        observable<z.infer<typeof Note>>((emit) => {
          const push = (note: z.infer<typeof Note>) => {
            emit.next(note);
          };
          noteListeners.add(push);
          const onAbort = () => emit.complete();
          signal?.addEventListener('abort', onAbort);
          return () => {
            noteListeners.delete(push);
            signal?.removeEventListener('abort', onAbort);
          };
        })) as never),
  }),
});

export type AppRouter = typeof appRouter;
