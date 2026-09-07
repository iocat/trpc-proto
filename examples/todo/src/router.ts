import { initTRPC } from "@trpc/server";
import { noopForNonTsBackend } from "@trpc-proto/runtime/noop";
import { createProtoTransformer } from "@trpc-proto/runtime/proto_codec";
import type { ProtoMeta } from "@trpc-proto/runtime";
import { z } from "zod";

const t = initTRPC.meta<ProtoMeta>().create({
  allowOutsideOfServer: true,
  transformer: createProtoTransformer(),
  defaultMeta: {
    proto: {
      package: "todo.v1",
      syntax: "proto3",
      cache: "generated/schema.json",
      options: {
        go_package: "todo/backend/gen/todov1",
      },
    },
  },
});

const Todo = z
  .object({
    id: z.string(),
    title: z.string(),
    notes: z.string().optional(),
    done: z.boolean(),
    createdAt: z.date(),
  })
  .meta({ protoMessageName: "Todo" });

const TodoListInput = z.object({
  done: z.boolean().optional(),
});

const TodoListOutput = z.object({
  items: z.array(Todo),
  total: z.int(),
});

const TodoCreateInput = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
});

const TodoSetDoneInput = z.object({
  id: z.string(),
  done: z.boolean(),
});

const TodoIdInput = z.object({
  id: z.string(),
});

const HealthOutput = z.object({ ok: z.boolean(), version: z.string() });

/** Schema-only. Resolvers are noops; the Go backend implements the RPCs. */
export const appRouter = t.router({
  health: t.procedure.output(HealthOutput).query(noopForNonTsBackend),

  todo: t.router({
    list: t.procedure
      .input(TodoListInput)
      .output(TodoListOutput)
      .query(noopForNonTsBackend),

    getById: t.procedure
      .input(TodoIdInput)
      .output(Todo)
      .query(noopForNonTsBackend),

    create: t.procedure
      .input(TodoCreateInput)
      .output(Todo)
      .mutation(noopForNonTsBackend),

    setDone: t.procedure
      .input(TodoSetDoneInput)
      .output(Todo)
      .mutation(noopForNonTsBackend),

    remove: t.procedure
      .input(TodoIdInput)
      .output(TodoIdInput)
      .mutation(noopForNonTsBackend),
  }),
});

export type AppRouter = typeof appRouter;
