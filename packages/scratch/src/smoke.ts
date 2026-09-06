import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { translate } from '@trpc-proto/plugin';
import { createCodec, type ProtoSchema } from '@trpc-proto/runtime';
import { z } from 'zod';
import { calcomAttendeeEmail } from './router.js';

const schemaPath = fileURLToPath(
  new URL('../generated/schema.json', import.meta.url),
);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as ProtoSchema;
const codec = createCodec(schema);

describe('cal.com sourced generate', () => {
  it('throws on Cal.com attendeeEmail string|object union', () => {
    assert.throws(
      () =>
        translate([
          {
            path: 'viewer.bookings.get',
            type: 'query',
            input: z.object({
              attendeeEmail: calcomAttendeeEmail.optional(),
            }),
          },
        ]),
      /Unsupported Zod type "union"/,
    );
  });

  it('roundtrips bookings.get filters and cursor', () => {
    const req = {
      filters: {
        teamIds: [1, 2],
        status: 'upcoming',
        statuses: ['past', 'cancelled'],
        attendeeEmail: 'ada@example.com',
        bookingUid: 'uid_1',
      },
      limit: 20,
      offset: 0,
      cursor: 'c1',
      sort: { sortStart: 'desc' },
    };
    const decoded = codec.decode(
      'ViewerBookingsGetRequest',
      codec.encode('ViewerBookingsGetRequest', req),
    ) as typeof req;
    assert.deepEqual(decoded.filters.teamIds, [1, 2]);
    assert.equal(decoded.filters.status, 'upcoming');
    assert.equal(decoded.limit, 20);
    assert.equal(decoded.sort.sortStart, 'desc');
  });

  it('roundtrips addGuests nested guests array', () => {
    const req = {
      bookingId: 42,
      guests: [
        { email: 'a@b.com', name: 'Ada', timeZone: 'UTC' },
        { email: 'b@c.com' },
      ],
    };
    const decoded = codec.decode(
      'ViewerBookingsAddGuestsRequest',
      codec.encode('ViewerBookingsAddGuestsRequest', req),
    ) as typeof req;
    assert.equal(decoded.bookingId, 42);
    assert.equal(decoded.guests[0]?.email, 'a@b.com');
    assert.equal(decoded.guests[1]?.email, 'b@c.com');
  });

  it('roundtrips updateProfile travelSchedules dates', () => {
    const start = new Date('2024-07-01T00:00:00.000Z');
    const req = {
      username: 'ada',
      theme: null,
      travelSchedules: [{ timeZone: 'Europe/London', startDate: start }],
    };
    const decoded = codec.decode(
      'ViewerMeUpdateProfileRequest',
      codec.encode('ViewerMeUpdateProfileRequest', req),
    ) as {
      username: string;
      travelSchedules: { timeZone: string; startDate: Date }[];
    };
    assert.equal(decoded.username, 'ada');
    assert.equal(
      decoded.travelSchedules[0]?.startDate.toISOString(),
      start.toISOString(),
    );
  });
});
