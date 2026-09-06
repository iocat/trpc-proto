import { initTRPC } from '@trpc/server';
import { noopForNonTsBackend } from '@trpc-proto/runtime/noop';
import { createProtoTransformer } from '@trpc-proto/runtime/proto_codec';
import type { ProtoMeta } from '@trpc-proto/runtime';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  allowOutsideOfServer: true,
  transformer: createProtoTransformer(),
  defaultMeta: {
    proto: {
      package: 'example.v1',
      cache: 'generated/schema.json',
      options: {
        go_package: 'users/backend/gen/examplev1',
      },
    },
  },
});

const Address = z
  .object({
    city: z.string().describe('The city of the address'),
    country: z.string().optional().describe('The country of this address'),
  })
  .meta({ id: 'Address' });

const Role = z.enum(['admin', 'member', 'guest']).meta({ id: 'UserRole' });

const User = z
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
  .meta({ id: 'User' });

const UserCreateInput = z.object({
  name: z.string().min(1),
  email: z.email(),
  role: Role.optional(),
  tags: z.array(z.string()).optional(),
  address: Address,
});

const UserListInput = z.object({
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
  .meta({ id: 'WorkspaceStats' });

const HealthOutput = z.object({ ok: z.boolean(), version: z.string() });
const HelloInput = z.object({
  description: z.string(),
  fullName: z.string().describe('use full name instead'),
});
const HelloOutput = z.object({ message: z.string() });

const IssueStatus = z
  .enum(['backlog', 'todo', 'in_progress', 'done'])
  .meta({ id: 'IssueStatus' });
const IssuePriority = z
  .enum(['none', 'low', 'medium', 'high', 'urgent'])
  .meta({ id: 'IssuePriority' });

const Issue = z
  .object({
    id: z.string(),
    number: z.int(),
    title: z.string(),
    description: z.string().optional(),
    status: IssueStatus,
    priority: IssuePriority,
    assigneeId: z.string().optional(),
    createdAt: z.date(),
    teamId: z.string().optional(),
  })
  .meta({ id: 'Issue' });

const IssueListInput = z.object({
  q: z.string().optional(),
  status: IssueStatus.optional(),
  assigneeId: z.string().optional(),
  teamId: z.string().optional(),
});

const IssueListOutput = z.object({
  items: z.array(Issue),
  total: z.int(),
});

const IssueCreateInput = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: IssueStatus.optional(),
  priority: IssuePriority.optional(),
  assigneeId: z.string().optional(),
  teamId: z.string().optional(),
});

const IssueUpdateInput = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: IssueStatus.optional(),
  priority: IssuePriority.optional(),
  assigneeId: z.string().optional(),
  teamId: z.string().optional(),
});

const UserUpdateInput = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  email: z.email().optional(),
  role: Role.optional(),
  tags: z.array(z.string()).optional(),
  address: Address.optional(),
  active: z.boolean().optional(),
});

const Team = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    description: z.string().optional(),
    memberIds: z.array(z.string()),
    createdAt: z.date(),
  })
  .meta({ id: 'Team' });

const TeamListOutput = z.object({
  items: z.array(Team),
  total: z.int(),
});

const TeamCreateInput = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  memberIds: z.array(z.string()).optional(),
});

const TeamUpdateInput = z.object({
  id: z.string(),
  key: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  memberIds: z.array(z.string()).optional(),
});

const TeamMemberInput = z.object({
  teamId: z.string(),
  userId: z.string(),
});



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

    update: t.procedure
      .input(UserUpdateInput)
      .output(User)
      .mutation(noopForNonTsBackend),
  }),


  org: t.router({
    workspace: t.router({
      stats: t.procedure.output(WorkspaceStats).query(noopForNonTsBackend),
    }),
  }),

  issue: t.router({
    getById: t.procedure
      .input(z.object({ id: z.string() }))
      .output(Issue)
      .query(noopForNonTsBackend),

    list: t.procedure
      .input(IssueListInput)
      .output(IssueListOutput)
      .query(noopForNonTsBackend),

    create: t.procedure
      .input(IssueCreateInput)
      .output(Issue)
      .mutation(noopForNonTsBackend),

    update: t.procedure
      .input(IssueUpdateInput)
      .output(Issue)
      .mutation(noopForNonTsBackend),

    onChange: t.procedure
      .input(z.object({}))
      .output(Issue)
      .subscription(noopForNonTsBackend as never),
  }),

  team: t.router({
    getById: t.procedure
      .input(z.object({ id: z.string() }))
      .output(Team)
      .query(noopForNonTsBackend),

    list: t.procedure
      .input(z.object({ q: z.string().optional() }))
      .output(TeamListOutput)
      .query(noopForNonTsBackend),

    create: t.procedure
      .input(TeamCreateInput)
      .output(Team)
      .mutation(noopForNonTsBackend),

    update: t.procedure
      .input(TeamUpdateInput)
      .output(Team)
      .mutation(noopForNonTsBackend),

    addMember: t.procedure
      .input(TeamMemberInput)
      .output(Team)
      .mutation(noopForNonTsBackend),

    removeMember: t.procedure
      .input(TeamMemberInput)
      .output(Team)
      .mutation(noopForNonTsBackend),
  }),
});

export type AppRouter = typeof appRouter;
