import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountBookingLimit } from '@/lib/accountBookings';
import { anonymousCaller, ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { guests } from '@/server/db/schema';
import { insertSession } from './holdFixtures';
import {
  client,
  giftPurchaseRow,
  insert,
  later,
  newOrder,
  parents,
  setupOrdersDatabase,
} from './orderFixtures';

// Behaviours under test, one per decision, branch or risk:
// - a signed-in guest with a verified email reads the confirmed and cancelled bookings made at that address, upcoming first, each with its manage token version
// - guest scope: another guest's bookings are never in the read, whoever asks, in either direction
// - an email the sign-in has not verified reads nothing, though bookings exist at the address
// - an address no guest booked with reads an empty list
// - an order still being paid for and a void one are not listed
// - a gift purchase is not listed; a mixed-case address cannot be stored on either side, so the join needs no folding
// - the list stops at the limit and never drops an upcoming booking for a past one; the past follow the upcoming, latest session first
// - nobody signed in, and a verified person with bookings but no guest role, are refused before the database is asked

let reads: typeof import('@/server/db/accountBookings');
const now = new Date('2026-11-10T12:00:00Z');
const hour = 3_600_000;

setupOrdersDatabase();

beforeAll(async () => {
  reads = await import('@/server/db/accountBookings');
});

/** A guest row at `email`, as a booking makes one. */
async function guestAt(email: string) {
  const [guest] = await client.db
    .insert(guests)
    .values({ email })
    .returning({ id: guests.id });
  if (!guest) throw new Error('no guest row');
  return guest.id;
}

/** A sign-in at `email`; returns the caller it gives. */
async function signedIn(email: string, verified = true) {
  const id = randomUUID();
  await insert('auth_users', { id, email, email_verified: verified });
  return testCaller({ userId: id });
}

async function booking(
  guestId: string,
  startsInHours: number,
  over: Record<string, unknown> = {},
) {
  const session = await insertSession(client.db, parents.experienceId, {
    startsAt: new Date(now.getTime() + startsInHours * hour),
    endsAt: new Date(now.getTime() + (startsInHours + 1) * hour),
  });
  return newOrder({
    status: 'confirmed',
    confirmed_at: later,
    session_id: session.id,
    guest_id: guestId,
    ...over,
  });
}

describe('readAccountBookings', () => {
  it('reads a verified guest’s confirmed and cancelled bookings, upcoming first', async () => {
    const guestId = await guestAt('ada@example.com');
    const caller = await signedIn('ada@example.com');
    const soon = await booking(guestId, 5);
    const furthest = await booking(guestId, 50);
    const cancelled = await booking(guestId, -30, {
      status: 'cancelled',
      cancelled_at: later,
      cancelled_by: 'guest',
    });

    const rows = await reads.readAccountBookings(caller, now);

    expect(rows.map((row) => row.id)).toEqual([soon, furthest, cancelled]);
    expect(rows[0]).toMatchObject({
      experienceName: 'Experience',
      status: 'confirmed',
      manageTokenVersion: 1,
    });
    expect(rows[2]?.status).toBe('cancelled');
  });

  it('never reads another guest’s bookings, in either direction', async () => {
    const graceId = await guestAt('grace@example.com');
    const alanId = await guestAt('alan@example.com');
    const grace = await signedIn('grace@example.com');
    const alan = await signedIn('alan@example.com');
    const graces = await booking(graceId, 7);
    const alans = await booking(alanId, 8);

    expect(
      (await reads.readAccountBookings(grace, now)).map((r) => r.id),
    ).toEqual([graces]);
    expect(
      (await reads.readAccountBookings(alan, now)).map((r) => r.id),
    ).toEqual([alans]);
  });

  it('gives host staff only their own bookings, never a guest’s on their host', async () => {
    const staffGuestId = await guestAt('staffer@example.com');
    const otherId = await guestAt('customer@example.com');
    const signed = await signedIn('staffer@example.com');
    const staff = testCaller({
      userId: signed.userId,
      roles: [Role.Guest, Role.HostStaff],
      hostIds: [parents.hostId],
    });
    const own = await booking(staffGuestId, 9);
    const customers = await booking(otherId, 10);

    const ids = (await reads.readAccountBookings(staff, now)).map((r) => r.id);

    expect(ids).toEqual([own]);
    expect(ids).not.toContain(customers);
  });

  it('reads nothing for an email the sign-in has not verified', async () => {
    const guestId = await guestAt('unverified@example.com');
    await booking(guestId, 9);
    const caller = await signedIn('unverified@example.com', false);

    expect(await reads.readAccountBookings(caller, now)).toEqual([]);
  });

  it('reads an empty list for an address no guest booked with', async () => {
    const caller = await signedIn('never-booked@example.com');

    expect(await reads.readAccountBookings(caller, now)).toEqual([]);
  });

  it('leaves out an order still being paid for and a void one', async () => {
    const guestId = await guestAt('filtered@example.com');
    const caller = await signedIn('filtered@example.com');
    const kept = await booking(guestId, 11);
    await booking(guestId, 12, {
      status: 'pending_payment',
      confirmed_at: null,
    });
    await booking(guestId, 13, { status: 'void', confirmed_at: null });

    const rows = await reads.readAccountBookings(caller, now);

    expect(rows.map((row) => row.id)).toEqual([kept]);
  });

  it('leaves out a gift purchase', async () => {
    const guestId = await guestAt('gifter@example.com');
    const caller = await signedIn('gifter@example.com');
    const kept = await booking(guestId, 15);
    await insert(
      'orders',
      giftPurchaseRow({
        guest_id: guestId,
        status: 'confirmed',
        confirmed_at: later,
      }),
    );

    const rows = await reads.readAccountBookings(caller, now);

    expect(rows.map((row) => row.id)).toEqual([kept]);
  });

  it('compares addresses as stored because neither table can hold a mixed-case one', async () => {
    await expect(guestAt('Case@Example.com')).rejects.toThrow();
    await expect(signedIn('Case@Example.com')).rejects.toThrow();
  });

  it('stops at the limit, keeping every upcoming booking, soonest first, before any past one', async () => {
    const guestId = await guestAt('many@example.com');
    const caller = await signedIn('many@example.com');
    const past = [await booking(guestId, -1), await booking(guestId, -2)];
    const upcoming: string[] = [];
    for (let hours = 1; hours <= accountBookingLimit + 1; hours += 1) {
      upcoming.push(await booking(guestId, hours));
    }

    const ids = (await reads.readAccountBookings(caller, now)).map((r) => r.id);

    expect(ids).toEqual(upcoming.slice(0, accountBookingLimit));
    expect(ids).not.toContain(upcoming[accountBookingLimit]);
    expect(ids).not.toContain(past[0]);
  });

  it('lists the past after the upcoming, latest first, when the cap is not reached', async () => {
    const guestId = await guestAt('mixed@example.com');
    const caller = await signedIn('mixed@example.com');
    const older = await booking(guestId, -50);
    const recent = await booking(guestId, -2);
    const cancelledAhead = await booking(guestId, 20, {
      status: 'cancelled',
      cancelled_at: later,
      cancelled_by: 'guest',
    });
    const next = await booking(guestId, 3);

    const rows = await reads.readAccountBookings(caller, now);

    expect(rows.map((r) => r.id)).toEqual([
      next,
      cancelledAhead,
      recent,
      older,
    ]);
  });

  it('refuses nobody signed in before reading', async () => {
    await expect(
      reads.readAccountBookings(anonymousCaller, now),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a verified person with bookings who holds no guest role', async () => {
    const guestId = await guestAt('roleless@example.com');
    const caller = await signedIn('roleless@example.com');
    await booking(guestId, 17);

    await expect(
      reads.readAccountBookings({ ...caller, roles: [] }, now),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
