import { initTRPC } from '@trpc/server';
import {
  createProtoTransformer,
  noopForNonTsBackend,
  type ProtoMeta,
} from '@trpc-proto/runtime';
import { z } from 'zod';

/**
 * Sourced from calcom/cal.diy (cal.com redirects here), not invented.
 *
 * Root: https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/_app.ts
 *   export const appRouter = router({ viewer: viewerRouter })
 *
 * Viewer: https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/_router.tsx
 *
 * Adaptations: handlers → noopForNonTsBackend; no `.output()`; attendeeEmail union dropped.
 */
const t = initTRPC.meta<ProtoMeta>().create({
  transformer: createProtoTransformer(),
  defaultMeta: {
    proto: {
      package: 'scratch.v1',
      syntax: 'proto3',
      cache: 'generated/schema.json',
    },
  },
});

const procedure = t.procedure;

/** https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/auth/changePassword.schema.ts */
const ZChangePasswordInputSchema = z.object({
  oldPassword: z.string(),
  newPassword: z.string(),
});

/** https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/me/deleteMe.schema.ts */
const ZDeleteMeInputSchema = z.object({
  password: z.string(),
  totpCode: z.string().optional(),
});

/**
 * https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/me/updateProfile.schema.ts
 * `metadata` / `bookerLayouts` / `timeZoneSchema` omitted (Prisma zod-utils).
 */
const ZUpdateProfileInputSchema = z.object({
  username: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  bio: z.string().optional(),
  avatarUrl: z.string().nullable().optional(),
  timeZone: z.string().optional(),
  weekStart: z.string().optional(),
  hideBranding: z.boolean().optional(),
  allowDynamicBooking: z.boolean().optional(),
  theme: z.string().optional().nullable(),
  locale: z.string().optional(),
  timeFormat: z.number().optional(),
  travelSchedules: z
    .array(
      z.object({
        id: z.number().optional(),
        timeZone: z.string(),
        endDate: z.date().optional(),
        startDate: z.date(),
      }),
    )
    .optional(),
  secondaryEmails: z
    .array(
      z.object({
        id: z.number(),
        email: z.string(),
        isDeleted: z.boolean().default(false),
      }),
    )
    .optional(),
});

/** https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/bookings/addGuests.schema.ts */
const ZGuestSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  timeZone: z.string().optional(),
  phoneNumber: z.string().optional(),
  language: z.string().optional(),
});

const ZAddGuestsInputSchema = z.object({
  bookingId: z.number(),
  guests: z.array(ZGuestSchema),
});

/**
 * https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/bookings/get.schema.ts
 * attendeeEmail/Name union dropped — see smoke.ts.
 */
const BookingStatus = z.enum([
  'upcoming',
  'recurring',
  'past',
  'cancelled',
  'unconfirmed',
]);

const ZGetBookingsInputSchema = z.object({
  filters: z.object({
    teamIds: z.number().array().optional(),
    userIds: z.number().array().optional(),
    status: BookingStatus.optional(),
    statuses: BookingStatus.array().optional(),
    eventTypeIds: z.number().array().optional(),
    attendeeEmail: z.string().optional(),
    attendeeName: z.string().optional(),
    bookingUid: z.string().optional(),
    afterStartDate: z.string().optional(),
    beforeEndDate: z.string().optional(),
    afterUpdatedDate: z.string().optional(),
    beforeUpdatedDate: z.string().optional(),
    afterCreatedDate: z.string().optional(),
    beforeCreatedDate: z.string().optional(),
  }),
  limit: z.number().min(1).max(100),
  offset: z.number().default(0),
  cursor: z.string().optional(),
  sort: z
    .object({
      sortStart: z.enum(['asc', 'desc']).optional(),
    })
    .optional(),
});

/** https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/eventTypes/get.schema.ts */
const ZGetEventTypeInputSchema = z.object({
  id: z.number(),
});

/**
 * https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/eventTypes/getByViewer.schema.ts
 * Prisma `SchedulingType` → string enum.
 */
const SchedulingType = z.enum(['ROUND_ROBIN', 'COLLECTIVE', 'MANAGED']);

const filterQuerySchemaStrict = z.object({
  teamIds: z.number().array().optional(),
  upIds: z.string().array().max(1).optional(),
  schedulingTypes: SchedulingType.array().optional(),
});

const ZEventTypeInputSchema = z
  .object({
    filters: filterQuerySchemaStrict.optional(),
  })
  .nullish();

const ZGetEventTypesFromGroupSchema = z.object({
  filters: filterQuerySchemaStrict.optional(),
  cursor: z.number().nullish(),
  limit: z.number().default(10),
  group: z.object({
    teamId: z.number().nullish(),
    parentId: z.number().nullish(),
  }),
  searchQuery: z.string().optional(),
});

const ZDeleteEventTypeInputSchema = z.object({
  id: z.number(),
});

/** https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/me/_router.tsx */
const meRouter = t.router({
  get: procedure.query(noopForNonTsBackend),
  deleteMe: procedure.input(ZDeleteMeInputSchema).mutation(noopForNonTsBackend),
  deleteMeWithoutPassword: procedure.mutation(noopForNonTsBackend),
  updateProfile: procedure.input(ZUpdateProfileInputSchema).mutation(noopForNonTsBackend),
  bookingUnconfirmedCount: procedure.query(noopForNonTsBackend),
  myStats: procedure.query(noopForNonTsBackend),
});

/** https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/auth/_router.tsx */
const authRouter = t.router({
  changePassword: procedure.input(ZChangePasswordInputSchema).mutation(noopForNonTsBackend),
  createAccountPassword: procedure.mutation(noopForNonTsBackend),
});

/** https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/bookings/_router.tsx */
const bookingsRouter = t.router({
  get: procedure.input(ZGetBookingsInputSchema).query(noopForNonTsBackend),
  addGuests: procedure.input(ZAddGuestsInputSchema).mutation(noopForNonTsBackend),
});

/** https://github.com/calcom/cal.diy/blob/main/packages/trpc/server/routers/viewer/eventTypes/_router.ts */
const eventTypesRouter = t.router({
  get: procedure.input(ZGetEventTypeInputSchema).query(noopForNonTsBackend),
  getByViewer: procedure.input(ZEventTypeInputSchema).query(noopForNonTsBackend),
  getEventTypesFromGroup: procedure
    .input(ZGetEventTypesFromGroupSchema)
    .query(noopForNonTsBackend),
  list: procedure.query(noopForNonTsBackend),
  delete: procedure.input(ZDeleteEventTypeInputSchema).mutation(noopForNonTsBackend),
  bulkUpdateToDefaultLocation: procedure
    .input(z.object({ eventTypeIds: z.array(z.number()) }))
    .mutation(noopForNonTsBackend),
});

const viewerRouter = t.router({
  me: meRouter,
  auth: authRouter,
  bookings: bookingsRouter,
  eventTypes: eventTypesRouter,
});

export const appRouter = t.router({
  viewer: viewerRouter,
});

export type AppRouter = typeof appRouter;

/** Exact Cal.com bookings.get filter field. Exported for the smoke throw test. */
export const calcomAttendeeEmail = z.union([
  z.string(),
  z.object({
    type: z.literal('t'),
    data: z.object({
      operator: z.enum([
        'equals',
        'notEquals',
        'contains',
        'notContains',
        'startsWith',
        'endsWith',
        'isEmpty',
        'isNotEmpty',
      ]),
      operand: z.string(),
    }),
  }),
]);
