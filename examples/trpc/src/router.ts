import { EventEmitter, on } from 'node:events';
import { initTRPC, TRPCError } from '@trpc/server';
import { zAsyncIterable, type ProtoMeta } from '@trpc-proto/runtime';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  allowOutsideOfServer: true,

  defaultMeta: {
    proto: {
      package: 'trpc.v1',
      cache: 'generated/schema.ts',
    },
  },
});

const Note = z
  .object({
    id: z.string(),
    body: z.string(),
  })
  .meta({ protoMessageName: 'Note' });

type NoteRecord = z.infer<typeof Note>;

const notes = new Map<string, NoteRecord>();
const noteEvents = new EventEmitter<{ change: [NoteRecord] }>();

async function* subscribeToNotes({
  signal,
}: {
  signal?: AbortSignal;
}): AsyncGenerator<NoteRecord, void, unknown> {
  const events = on(noteEvents, 'change', {
    signal,
  }) as AsyncIterable<[NoteRecord]>;
  for await (const [note] of events) yield note;
}

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
        noteEvents.emit('change', input);
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
      .output(zAsyncIterable({ yield: Note }))
      .subscription(subscribeToNotes),
  }),
});

export type AppRouter = typeof appRouter;
