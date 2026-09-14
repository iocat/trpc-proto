import { initTRPC } from '@trpc/server';
import { zAsyncIterable, type ProtoMeta } from '@trpc-proto/runtime';
import { noopForNonTsBackend } from '@trpc-proto/runtime/noop';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  allowOutsideOfServer: true,
  defaultMeta: {
    proto: {
      package: 'operations.v1',
      syntax: 'proto3',
      schemaPath: 'generated/schema.ts',
    },
  },
});

const IncidentStatus = z
  .enum(['investigating', 'identified', 'monitoring', 'resolved'])
  .meta({ protoEnumName: 'IncidentStatus' });

const IncidentSeverity = z
  .enum(['sev1', 'sev2', 'sev3', 'sev4'])
  .meta({ protoEnumName: 'IncidentSeverity' });

const ActivityKind = z
  .enum([
    'incident_created',
    'incident_updated',
    'note_added',
    'responder_joined',
    'incident_deleted',
    'heartbeat',
  ])
  .meta({ protoEnumName: 'ActivityKind' });

const Responder = z
  .object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    avatarColor: z.string(),
    online: z.boolean(),
  })
  .describe('A responder available to command or assist an incident.')
  .meta({ protoMessageName: 'Responder' });

const ChecklistItem = z
  .object({
    id: z.string(),
    label: z.string(),
    completed: z.boolean(),
  })
  .meta({ protoMessageName: 'ChecklistItem' });

const Incident = z
  .object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    service: z.string(),
    status: IncidentStatus,
    severity: IncidentSeverity,
    commander: Responder.optional(),
    tags: z.array(z.string()),
    labels: z.record(z.string(), z.string()),
    checklist: z.array(ChecklistItem),
    createdAt: z.date(),
    updatedAt: z.date(),
    revision: z.int(),
  })
  .describe('The current materialized state of an operational incident.')
  .meta({ protoMessageName: 'Incident' });

const TimelineEntry = z
  .object({
    id: z.string(),
    incidentId: z.string(),
    kind: ActivityKind,
    actor: Responder.optional(),
    message: z.string(),
    createdAt: z.date(),
    revision: z.int(),
  })
  .meta({ protoMessageName: 'TimelineEntry' });

const IncidentEvent = z
  .object({
    revision: z.int(),
    kind: ActivityKind,
    incident: Incident.optional(),
    entry: TimelineEntry.optional(),
    incidentId: z.string(),
    emittedAt: z.date(),
  })
  .describe('A resumable event emitted when incident state changes.')
  .meta({ protoMessageName: 'IncidentEvent' });

const OperationsSnapshot = z
  .object({
    incidents: z.array(Incident),
    responders: z.array(Responder),
    openBySeverity: z.record(z.string(), z.int()),
    services: z.array(z.string()),
    revision: z.int(),
  })
  .meta({ protoMessageName: 'OperationsSnapshot' });

const IncidentListInput = z.object({
  query: z.string().optional(),
  status: IncidentStatus.optional(),
  severity: IncidentSeverity.optional(),
  service: z.string().optional(),
  pageSize: z.int().min(1).max(100).optional(),
});

const IncidentListOutput = z.object({
  items: z.array(Incident),
  total: z.int(),
  revision: z.int(),
});

const IncidentCreateInput = z.object({
  title: z.string().min(3).max(120),
  summary: z.string().min(3).max(2_000),
  service: z.string().min(1).max(80),
  severity: IncidentSeverity,
  commanderId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

const IncidentUpdateInput = z.object({
  id: z.string(),
  title: z.string().min(3).max(120).optional(),
  summary: z.string().min(3).max(2_000).optional(),
  service: z.string().min(1).max(80).optional(),
  status: IncidentStatus.optional(),
  severity: IncidentSeverity.optional(),
  commanderId: z.string().optional(),
  clearCommander: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  replaceTags: z.boolean().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  replaceLabels: z.boolean().optional(),
});

/** Schema-only router. The Rust backend owns state and implements every RPC. */
export const appRouter = t.router({
  operations: t.router({
    snapshot: t.procedure
      .input(z.object({}))
      .output(OperationsSnapshot)
      .query(noopForNonTsBackend),

    responders: t.procedure
      .input(z.object({ onlineOnly: z.boolean().optional() }))
      .output(z.object({ items: z.array(Responder) }))
      .query(noopForNonTsBackend),
  }),

  incident: t.router({
    list: t.procedure
      .input(IncidentListInput)
      .output(IncidentListOutput)
      .query(noopForNonTsBackend),

    get: t.procedure
      .input(z.object({ id: z.string() }))
      .output(Incident)
      .query(noopForNonTsBackend),

    create: t.procedure
      .input(IncidentCreateInput)
      .output(Incident)
      .mutation(noopForNonTsBackend),

    update: t.procedure
      .input(IncidentUpdateInput)
      .output(Incident)
      .mutation(noopForNonTsBackend),

    toggleChecklist: t.procedure
      .input(
        z.object({
          incidentId: z.string(),
          itemId: z.string(),
          completed: z.boolean(),
        }),
      )
      .output(Incident)
      .mutation(noopForNonTsBackend),

    delete: t.procedure
      .input(z.object({ id: z.string() }))
      .output(
        z.object({
          id: z.string(),
          deleted: z.boolean(),
          revision: z.int(),
        }),
      )
      .mutation(noopForNonTsBackend),

    addNote: t.procedure
      .input(
        z.object({
          incidentId: z.string(),
          authorId: z.string(),
          message: z.string().min(1).max(2_000),
        }),
      )
      .output(TimelineEntry)
      .mutation(noopForNonTsBackend),

    timeline: t.procedure
      .input(z.object({ incidentId: z.string() }))
      .output(z.object({ items: z.array(TimelineEntry) }))
      .query(noopForNonTsBackend),

    watch: t.procedure
      .input(
        z.object({
          afterRevision: z.int().optional(),
          heartbeatSeconds: z.int().min(1).max(30).optional(),
        }),
      )
      .output(zAsyncIterable({ yield: IncidentEvent }))
      .subscription(noopForNonTsBackend),
  }),
});

export type AppRouter = typeof appRouter;
