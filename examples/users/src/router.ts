import { initTRPC } from "@trpc/server";
import {
  createProtoTransformer,
  noopForNonTsBackend,
  type ProtoMeta,
} from "@trpc-proto/runtime";
import { z } from "zod";

const t = initTRPC.meta<ProtoMeta>().create({
  transformer: createProtoTransformer(),
  defaultMeta: {
    proto: {
      package: "example.v1",
      cache: "generated/schema.json",
      options: {
        go_package: "users/backend/gen/examplev1",
      },
    },
  },
});

const Address = z
  .object({
    city: z.string().describe("The city of the address"),
    country: z.string().optional().describe("The country of this address"),
  })
  .meta({ id: "Address" });

const Role = z.enum(["admin", "member", "guest"]).meta({ id: "UserRole" });

export const User = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    role: Role,
    tags: z.array(z.string()),
    address: Address,
    createdAt: z.date(),
    active: z.boolean(),
    karma: z.int(),
    score: z.number(),
    balance: z.bigint(),
  })
  .meta({ id: "User" });

export const UserCreateInput = z.object({
  name: z.string().min(1),
  email: z.email(),
  role: Role.optional(),
  tags: z.array(z.string()).optional(),
  address: Address,
});

export const UserListInput = z.object({
  q: z.string().optional(),
  role: Role.optional(),
  page: z.int().optional(),
});

const UserListOutput = z.object({
  items: z.array(User),
  total: z.int(),
});

const WorkspaceStats = z
  .object({
    name: z.string(),
    users: z.int(),
    labels: z.record(z.string(), z.int()),
  })
  .meta({ id: "WorkspaceStats" });

const HealthOutput = z.object({ ok: z.boolean(), version: z.string() });
const HelloInput = z.object({
  description: z.string(),
  fullName: z.string().describe("use full name instead"),
});
const HelloOutput = z.object({ message: z.string() });

/** Schema-only. Resolvers are noops; a proto backend implements the RPCs. */
export const appRouter = t.router({
  health: t.procedure.output(HealthOutput).query(noopForNonTsBackend),

  hello: t.procedure
    .input(HelloInput)
    .output(HelloOutput)
    .query(noopForNonTsBackend),

  echo: t.procedure
    .input(z.string())
    .output(z.string())
    .query(noopForNonTsBackend),

  user: t.router({
    getById: t.procedure
      .input(z.object({ id: z.string() }))
      .output(User)
      .query(noopForNonTsBackend),

    list: t.procedure
      .input(UserListInput)
      .output(UserListOutput)
      .query(noopForNonTsBackend),

    create: t.procedure
      .input(UserCreateInput)
      .output(User)
      .mutation(noopForNonTsBackend),
  }),

  org: t.router({
    workspace: t.router({
      stats: t.procedure.output(WorkspaceStats).query(noopForNonTsBackend),
    }),
  }),
});

export type AppRouter = typeof appRouter;
