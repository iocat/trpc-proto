import { initTRPC } from '@trpc/server';
import { zAsyncIterable, type ProtoMeta } from '@trpc-proto/runtime';
import { noopForNonTsBackend } from '@trpc-proto/runtime/noop';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  allowOutsideOfServer: true,
  defaultMeta: {
    proto: {
      package: 'stream.v1',
      syntax: 'proto3',
      cache: 'generated/schema.ts',
    },
  },
});

const ChatRequest = z.object({
  prompt: z.string().min(1).max(2_000),
  tokensPerSecond: z.int().min(1).max(500),
  maxTokens: z.int().min(16).max(2_000),
});

const ChatEvent = z
  .object({
    sequence: z.int(),
    kind: z.string(),
    content: z.string(),
    sentAtUnixMs: z.number(),
    progress: z.number(),
  })
  .meta({ protoMessageName: 'ChatEvent' });

/** Schema-only router. The Rust backend implements this streaming RPC. */
export const appRouter = t.router({
  chat: t.router({
    respond: t.procedure
      .input(ChatRequest)
      .output(zAsyncIterable({ yield: ChatEvent }))
      .subscription(noopForNonTsBackend),
  }),
});

export type AppRouter = typeof appRouter;
