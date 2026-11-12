import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { anonymousCaller, ForbiddenError } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { guests } from '@/server/db/schema';
import { insertSession } from './holdFixtures';
import {
  client,
  insert,
  later,
  newOrder,
  parents,
  setupOrdersDatabase,
} from './orderFixtures';

// Behaviours under test, one per decision, branch or risk:
// - a signed-in guest with a verified email reads the confirmed and cancelled bookings made at that address, latest session first, each with its manage token version
// - guest scope: another guest's bookings are never in the read, whoever asks, in either direction
// - an email the sign-in has not verified reads nothing, though bookings exist at the address
// - an address no guest booked with reads an empty list
// - an order still being paid for and a void one are not listed
// - nobody signed in, and a caller with no guest role, are refused before the database is asked

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
  it('reads a verified guest’s confirmed and cancelled bookings, latest session first', async () => {
    const guestId = await guestAt('ada@example.com');
    const caller = await signedIn('ada@example.com');
    const soon = await booking(guestId, 5);
    const furthest = await booking(guestId, 50);
    const cancelled = await booking(guestId, -30, {
      status: 'cancelled',
      cancelled_at: later,
      cancelled_by: 'guest',
    });

    const rows = await reads.readAccountBookings(caller);

    expect(rows.map((row) => row.id)).toEqual([furthest, soon, cancelled]);
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

    expect((await reads.readAccountBookings(grace)).map((r) => r.id)).toEqual([
      graces,
    ]);
    expect((await reads.readAccountBookings(alan)).map((r) => r.id)).toEqual([
      alans,
    ]);
  });

  it('reads nothing for an email the sign-in has not verified', async () => {
    const guestId = await guestAt('unverified@example.com');
    await booking(guestId, 9);
    const caller = await signedIn('unverified@example.com', false);

    expect(await reads.readAccountBookings(caller)).toEqual([]);
  });

  it('reads an empty list for an address no guest booked with', async () => {
    const caller = await signedIn('never-booked@example.com');

    expect(await reads.readAccountBookings(caller)).toEqual([]);
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

    const rows = await reads.readAccountBookings(caller);

    expect(rows.map((row) => row.id)).toEqual([kept]);
  });

  it.each([
    ['nobody signed in', () => anonymousCaller],
    ['a caller with no role', () => testCaller({ roles: [] })],
  ])('refuses %s before reading', async (_name, caller) => {
    await expect(reads.readAccountBookings(caller())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
