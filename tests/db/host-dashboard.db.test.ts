import { beforeAll, describe, expect, it } from 'vitest';
import { hostDashboardLimits } from '@/lib/hostDashboard';
import {
  anonymousCaller,
  ForbiddenError,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { priceOptions } from '@/server/db/schema';
import { insertSession } from './holdFixtures';
import { createOrderParents } from './orderParents';
import {
  client,
  insert,
  later,
  newOrder,
  parents,
  setupOrdersDatabase,
} from './orderFixtures';

// Behaviours under test, one per decision, branch or risk:
// - an owner reads their own host's name, next scheduled sessions with seats sold, and latest bookings
// - the owner of host A cannot read host B: refused, and nothing of B is in A's read
// - host staff of another host, a guest, ops, admin, and nobody signed in are refused; host staff of the host read it (ops and admin have no host to read as)
// - sessions are the scheduled ones from now on, soonest first, within the limit; past, cancelled, and other hosts' are left out
// - bookings are confirmed and cancelled orders of kind booking, latest first, with seats counted from the lines that use a space
// - a host that does not exist reads as null for its owner grant
// - an id that is no uuid is refused before the database is asked
// - a line that takes no space is not counted as a seat
// - the bookings stop at the limit and the newest comes first

let reads: typeof import('@/server/db/hostDashboard');
const other = { ...parents };
const now = new Date('2026-11-10T12:00:00Z');
const hour = 3_600_000;

const owner = (hostId: string): Caller =>
  testCaller({ roles: [Role.HostOwner], hostIds: [hostId] });

setupOrdersDatabase();

beforeAll(async () => {
  Object.assign(other, await createOrderParents(client.db, 'hostb'));
  reads = await import('@/server/db/hostDashboard');
});

async function confirmedBooking(
  p: typeof parents,
  over: Record<string, unknown> = {},
  seats = 2,
) {
  const orderId = await newOrder({
    status: 'confirmed',
    confirmed_at: later,
    host_id: p.hostId,
    experience_id: p.experienceId,
    session_id: p.sessionId,
    guest_id: p.guestId,
    terms_document_id: p.termsDocumentId,
    cancellation_tier_id: p.tierId,
    ...over,
  });
  await insert('order_items', {
    order_id: orderId,
    price_option_id: p.priceOptionId,
    label: 'Adult',
    quantity: seats,
    unit_price_minor: 8500,
    uses_space: true,
    line_total_minor: 8500 * seats,
  });
  return orderId;
}

describe('readHostDashboard', () => {
  it('gives an owner their host with its upcoming sessions and bookings', async () => {
    const soon = await insertSession(client.db, parents.experienceId, {
      startsAt: new Date(now.getTime() + 2 * hour),
      endsAt: new Date(now.getTime() + 4 * hour),
      seatsSold: 2,
    });
    const orderId = await confirmedBooking(parents, {
      session_id: soon.id,
      lead_guest_name: 'Ada Lovelace',
      total_minor: 18509,
    });
    // A line that takes no space (a child who sits on a lap) is not a seat.
    const [lap] = await client.db
      .insert(priceOptions)
      .values({
        experienceId: parents.experienceId,
        kind: 'child',
        priceMinor: 0,
        usesSpace: false,
      })
      .returning();
    await insert('order_items', {
      order_id: orderId,
      price_option_id: lap?.id,
      label: 'Child on lap',
      quantity: 3,
      unit_price_minor: 0,
      uses_space: false,
      line_total_minor: 0,
    });

    const data = await reads.readHostDashboard(
      owner(parents.hostId),
      parents.hostId,
      now,
    );

    expect(data?.hostName).toBe('Host');
    expect(data?.sessions.find((s) => s.id === soon.id)).toMatchObject({
      allocation: 10,
      seatsSold: 2,
      experienceName: 'Experience',
    });
    expect(data?.bookings.find((b) => b.id === orderId)).toMatchObject({
      leadGuestName: 'Ada Lovelace',
      seats: 2, // the two adults; the three lap lines are not seats
      totalMinor: 18509,
      status: 'confirmed',
    });
  });

  it('refuses the owner of another host, and shows none of the other host', async () => {
    const hostBSession = await insertSession(client.db, other.experienceId, {
      startsAt: new Date(now.getTime() + hour),
      endsAt: new Date(now.getTime() + 2 * hour),
    });
    const hostBOrder = await confirmedBooking(other, {
      session_id: hostBSession.id,
    });

    await expect(
      reads.readHostDashboard(owner(parents.hostId), other.hostId, now),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const own = await reads.readHostDashboard(
      owner(parents.hostId),
      parents.hostId,
      now,
    );
    expect(own?.sessions.map((s) => s.id)).not.toContain(hostBSession.id);
    expect(own?.bookings.map((b) => b.id)).not.toContain(hostBOrder);
  });

  it.each([
    ['nobody signed in', anonymousCaller],
    ['a guest', testCaller()],
    ['ops', testCaller({ roles: [Role.Ops] })],
    ['admin', testCaller({ roles: [Role.Admin] })],
    [
      'host staff of another host',
      testCaller({
        roles: [Role.HostStaff],
        hostIds: ['00000000-0000-4000-8000-0000000000ff'],
      }),
    ],
  ])('refuses %s', async (_name, caller) => {
    await expect(
      reads.readHostDashboard(caller, parents.hostId, now),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets host staff of the host read it', async () => {
    const staff = testCaller({
      roles: [Role.HostStaff],
      hostIds: [parents.hostId],
    });

    const data = await reads.readHostDashboard(staff, parents.hostId, now);

    expect(data?.hostName).toBe('Host');
  });

  it('lists scheduled sessions from now, soonest first, and leaves out past and cancelled ones', async () => {
    const soonest = await insertSession(client.db, parents.experienceId, {
      startsAt: new Date(now.getTime() + hour / 2),
      endsAt: new Date(now.getTime() + hour),
    });
    const past = await insertSession(client.db, parents.experienceId, {
      startsAt: new Date(now.getTime() - hour),
      endsAt: new Date(now.getTime() + hour),
    });
    const cancelled = await insertSession(client.db, parents.experienceId, {
      startsAt: new Date(now.getTime() + 3 * hour),
      endsAt: new Date(now.getTime() + 5 * hour),
      status: 'cancelled',
      cancelReason: 'host',
    });

    const data = await reads.readHostDashboard(
      owner(parents.hostId),
      parents.hostId,
      now,
    );
    const ids = data?.sessions.map((s) => s.id) ?? [];
    const starts = data?.sessions.map((s) => s.startsAt.getTime()) ?? [];

    expect(ids[0]).toBe(soonest.id);
    expect(ids).not.toContain(past.id);
    expect(ids).not.toContain(cancelled.id);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('keeps the sessions within the limit, soonest first', async () => {
    await Promise.all(
      Array.from({ length: hostDashboardLimits.sessions + 2 }, (_, n) =>
        insertSession(client.db, parents.experienceId, {
          startsAt: new Date(now.getTime() + (10 + n) * hour),
          endsAt: new Date(now.getTime() + (11 + n) * hour),
        }),
      ),
    );
    const data = await reads.readHostDashboard(
      owner(parents.hostId),
      parents.hostId,
      now,
    );
    expect(data?.sessions).toHaveLength(hostDashboardLimits.sessions);
  });

  it('shows confirmed and cancelled bookings only, not an order still being paid for', async () => {
    const pending = await newOrder({ status: 'pending_payment' });
    const confirmed = await confirmedBooking(parents);
    const cancelled = await confirmedBooking(parents, {
      status: 'cancelled',
      cancelled_at: later,
      cancelled_by: 'guest',
    });

    const data = await reads.readHostDashboard(
      owner(parents.hostId),
      parents.hostId,
      now,
    );
    const ids = data?.bookings.map((b) => b.id) ?? [];

    expect(ids).toContain(confirmed);
    expect(ids).toContain(cancelled);
    expect(ids).not.toContain(pending);
    expect(data?.bookings.find((b) => b.id === cancelled)?.status).toBe(
      'cancelled',
    );
  });

  it('reads null for an owner grant on a host that does not exist', async () => {
    const missing = '11111111-1111-4111-8111-111111111111';
    await expect(
      reads.readHostDashboard(owner(missing), missing, now),
    ).resolves.toBeNull();
  });

  it('refuses an id that is no uuid before reading', async () => {
    await expect(
      reads.readHostDashboard(owner('x'), 'x', now),
    ).rejects.toThrow();
  });

  it('keeps the bookings within the limit and puts the newest first', async () => {
    // Run last: these are newer than every booking made above, so they fill the limit.
    const made: string[] = [];
    for (
      let minute = 0;
      minute < hostDashboardLimits.bookings + 2;
      minute += 1
    ) {
      const at = `2026-11-05T10:${String(minute).padStart(2, '0')}:00Z`;
      made.push(
        await confirmedBooking(parents, {
          created_at: at,
          confirmed_at: at,
        }),
      );
    }

    const data = await reads.readHostDashboard(
      owner(parents.hostId),
      parents.hostId,
      now,
    );

    expect(data?.bookings).toHaveLength(hostDashboardLimits.bookings);
    expect(data?.bookings.map((b) => b.id)).toEqual(
      made.slice(-hostDashboardLimits.bookings).reverse(),
    );
  });
});
