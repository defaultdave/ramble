import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { hostBookingListLimit } from '@/lib/hostGuestLists';
import {
  anonymousCaller,
  ForbiddenError,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { experiences, priceOptions } from '@/server/db/schema';
import { insertSession } from './holdFixtures';
import { createOrderParents } from './orderParents';
import {
  client,
  insert,
  later,
  newOrder,
  parents,
  reference,
  setupOrdersDatabase,
} from './orderFixtures';

// Behaviours under test, one per decision, branch or risk:
// guest list of one session
// - an owner reads the session and its confirmed bookings by lead guest's name, with seats from the lines that use a space, ages, guardian, waiver, and contacts
// - a cancelled booking and one still being paid for are not on the day's list
// - a session of another host reads as null, as does a missing one, and none of the other host's guests are in the owner's read
// - the owner of another host asking for this host is refused
// - a booking the host's experience asks a waiver for reads required, and an accepted one reads accepted
// - host staff of the host read the list with contacts and booking facts, but with no children's ages and no guardian (the fields are absent, not null); the owner still sees them; host staff of another host are refused
// - nobody signed in, a guest, ops, admin, and host staff of another host are refused; an id that is no uuid is refused before the database is asked
// bookings list and search
// - the list is the host's confirmed and cancelled bookings, latest first, never another host's, never one still being paid for
// - search finds a booking by part of its reference or of the lead guest's name, in any case, and only among the host's own
// - search takes % and _ literally, and an empty or blank term lists everything
// - a term over the cap is refused before the database is asked
// - the list stops at the limit
// - host staff of the host read the list; nobody signed in, a guest, ops, admin, host staff of another host, and the owner of another host are refused

let reads: typeof import('@/server/db/hostGuestLists');
const other = { ...parents };
const now = new Date('2026-11-10T12:00:00Z');
const hour = 3_600_000;

const owner = (hostId: string): Caller =>
  testCaller({ roles: [Role.HostOwner], hostIds: [hostId] });

// Built when a test runs: the hosts are made in beforeAll, after this file is loaded.
const notOwners: [string, () => Caller][] = [
  ['nobody signed in', () => anonymousCaller],
  ['a guest', () => testCaller()],
  ['ops', () => testCaller({ roles: [Role.Ops] })],
  ['admin', () => testCaller({ roles: [Role.Admin] })],
  [
    'host staff of another host',
    () => testCaller({ roles: [Role.HostStaff], hostIds: [other.hostId] }),
  ],
];

setupOrdersDatabase();

beforeAll(async () => {
  Object.assign(other, await createOrderParents(client.db, 'hostb'));
  reads = await import('@/server/db/hostGuestLists');
});

async function booking(
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

async function sessionOf(p: typeof parents, startsInHours = 5) {
  return insertSession(client.db, p.experienceId, {
    startsAt: new Date(now.getTime() + startsInHours * hour),
    endsAt: new Date(now.getTime() + (startsInHours + 1) * hour),
  });
}

describe('readHostGuestList', () => {
  it('gives an owner the session with its confirmed bookings by name, with every detail the host may see', async () => {
    const session = await sessionOf(parents);
    const ada = await booking(
      parents,
      {
        session_id: session.id,
        lead_guest_name: 'Ada Lovelace',
        contact_email: 'ada@example.com',
        contact_phone: '+1 555 0100',
        children_ages: [8, 11],
        guardian_name: 'Ada Lovelace',
        guardian_contact: 'ada@example.com',
        waiver_document_id: parents.termsDocumentId,
      },
      2,
    );
    // A line that takes no space (a child on a lap) is not a seat.
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
      order_id: ada,
      price_option_id: lap?.id,
      label: 'Child on lap',
      quantity: 3,
      unit_price_minor: 0,
      uses_space: false,
      line_total_minor: 0,
    });
    const grace = await booking(
      parents,
      {
        session_id: session.id,
        lead_guest_name: 'Grace Hopper',
        age_confirmed: true,
      },
      1,
    );

    const data = await reads.readHostGuestList(
      owner(parents.hostId),
      parents.hostId,
      session.id,
    );

    expect(data?.session).toMatchObject({
      id: session.id,
      hostName: 'Host',
      experienceName: 'Experience',
      waiverRequired: false,
    });
    // Ada sorts before Grace; seats are the two adults, not the three lap lines.
    expect(data?.bookings.map((b) => b.id)).toEqual([ada, grace]);
    expect(data?.bookings[0]).toMatchObject({
      leadGuestName: 'Ada Lovelace',
      seats: 2,
      childrenAges: [8, 11],
      guardianName: 'Ada Lovelace',
      guardianContact: 'ada@example.com',
      waiverAccepted: true,
      contactEmail: 'ada@example.com',
      contactPhone: '+1 555 0100',
    });
    expect(data?.bookings[1]).toMatchObject({
      seats: 1,
      ageConfirmed: true,
      childrenAges: null,
      waiverAccepted: false,
      contactPhone: null,
    });
  });

  it('leaves out a cancelled booking and one still being paid for', async () => {
    const session = await sessionOf(parents, 6);
    const confirmed = await booking(parents, { session_id: session.id });
    const cancelled = await booking(parents, {
      session_id: session.id,
      status: 'cancelled',
      cancelled_at: later,
      cancelled_by: 'guest',
    });
    const pending = await newOrder({
      session_id: session.id,
      status: 'pending_payment',
    });

    const data = await reads.readHostGuestList(
      owner(parents.hostId),
      parents.hostId,
      session.id,
    );

    expect(data?.bookings.map((b) => b.id)).toEqual([confirmed]);
    expect(data?.bookings.map((b) => b.id)).not.toContain(cancelled);
    expect(data?.bookings.map((b) => b.id)).not.toContain(pending);
  });

  it('reads null for another host’s session and shows none of the other host’s guests', async () => {
    const hostBSession = await sessionOf(other, 7);
    await booking(other, {
      session_id: hostBSession.id,
      lead_guest_name: 'Zelda Other-Host',
      contact_email: 'zelda@other.example',
    });

    await expect(
      reads.readHostGuestList(
        owner(parents.hostId),
        parents.hostId,
        hostBSession.id,
      ),
    ).resolves.toBeNull();
    // The host B owner sees it, so the null above is the host filter and not a missing session.
    const theirs = await reads.readHostGuestList(
      owner(other.hostId),
      other.hostId,
      hostBSession.id,
    );
    expect(theirs?.bookings.map((b) => b.leadGuestName)).toEqual([
      'Zelda Other-Host',
    ]);
  });

  it('gives host staff the booking and contacts, without the children’s ages or the guardian', async () => {
    const session = await sessionOf(parents, 12);
    await booking(parents, {
      session_id: session.id,
      lead_guest_name: 'Ada Lovelace',
      contact_email: 'ada@example.com',
      contact_phone: '+1 555 0100',
      children_ages: [8, 11],
      guardian_name: 'Ada Lovelace',
      guardian_contact: 'ada@example.com',
    });
    const staff = testCaller({
      roles: [Role.HostStaff],
      hostIds: [parents.hostId],
    });

    const data = await reads.readHostGuestList(
      staff,
      parents.hostId,
      session.id,
    );

    expect(data?.scope).toBe('staff');
    expect(data?.bookings[0]).toMatchObject({
      leadGuestName: 'Ada Lovelace',
      contactEmail: 'ada@example.com',
      contactPhone: '+1 555 0100',
    });
    const keys = Object.keys(data?.bookings[0] ?? {});
    expect(keys).not.toContain('childrenAges');
    expect(keys).not.toContain('guardianName');
    expect(keys).not.toContain('guardianContact');
  });

  it('refuses the owner of another host asking for this host', async () => {
    const session = await sessionOf(parents, 8);
    await expect(
      reads.readHostGuestList(owner(other.hostId), parents.hostId, session.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each(notOwners)('refuses %s', async (_name, caller) => {
    const session = await sessionOf(parents, 9);
    await expect(
      reads.readHostGuestList(caller(), parents.hostId, session.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('reads a waiver as required when the experience asks for one', async () => {
    await client.db
      .update(experiences)
      .set({ waiverDocumentId: parents.termsDocumentId })
      .where(eq(experiences.id, parents.experienceId));
    const session = await sessionOf(parents, 10);
    await booking(parents, { session_id: session.id });

    const data = await reads.readHostGuestList(
      owner(parents.hostId),
      parents.hostId,
      session.id,
    );

    expect(data?.session.waiverRequired).toBe(true);
    expect(data?.bookings[0]?.waiverAccepted).toBe(false);
  });

  it('reads null for a session that does not exist', async () => {
    await expect(
      reads.readHostGuestList(
        owner(parents.hostId),
        parents.hostId,
        '11111111-1111-4111-8111-111111111111',
      ),
    ).resolves.toBeNull();
  });

  it('refuses an id that is no uuid before reading', async () => {
    await expect(
      reads.readHostGuestList(owner(parents.hostId), parents.hostId, 'x'),
    ).rejects.toThrow();
  });
});

describe('readHostBookings', () => {
  it('lists confirmed and cancelled bookings of the host, latest first, and nothing else', async () => {
    const older = await booking(parents, {
      created_at: '2026-11-02T10:00:00Z',
      confirmed_at: '2026-11-02T10:00:00Z',
      lead_guest_name: 'Older Booker',
    });
    const newer = await booking(parents, {
      created_at: '2026-11-02T11:00:00Z',
      confirmed_at: '2026-11-02T11:00:00Z',
      lead_guest_name: 'Newer Booker',
      status: 'cancelled',
      cancelled_at: '2026-11-02T11:00:00Z',
      cancelled_by: 'guest',
    });
    const pending = await newOrder({ lead_guest_name: 'Pending Booker' });
    const hostB = await booking(other, {
      created_at: '2026-11-02T12:00:00Z',
      confirmed_at: '2026-11-02T12:00:00Z',
      lead_guest_name: 'Hostb Booker',
    });

    const data = await reads.readHostBookings(
      owner(parents.hostId),
      parents.hostId,
      '',
    );
    const ids = data.bookings.map((b) => b.id);

    expect(ids.indexOf(newer)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    expect(data.bookings.find((b) => b.id === newer)).toMatchObject({
      status: 'cancelled',
      seats: 2,
      sessionId: parents.sessionId,
      experienceName: 'Experience',
    });
    expect(ids).not.toContain(pending);
    expect(ids).not.toContain(hostB);
  });

  it('finds a booking by part of its reference in any case, and by part of the guest’s name', async () => {
    const ref = reference();
    const id = await booking(parents, {
      reference: ref,
      lead_guest_name: 'Wilhelmina Searchable',
    });

    const byReference = await reads.readHostBookings(
      owner(parents.hostId),
      parents.hostId,
      ref.slice(4, 8).toLowerCase(),
    );
    const byName = await reads.readHostBookings(
      owner(parents.hostId),
      parents.hostId,
      'hELMINA sear',
    );

    expect(byReference.bookings.map((b) => b.id)).toContain(id);
    expect(byName.bookings.map((b) => b.id)).toEqual([id]);
  });

  it('searches the host’s own bookings only', async () => {
    const mine = await booking(parents, { lead_guest_name: 'Shared Name' });
    const theirs = await booking(other, { lead_guest_name: 'Shared Name' });

    const found = await reads.readHostBookings(
      owner(parents.hostId),
      parents.hostId,
      'shared name',
    );

    expect(found.bookings.map((b) => b.id)).toEqual([mine]);
    expect(found.bookings.map((b) => b.id)).not.toContain(theirs);
  });

  it('takes % and _ in a term literally', async () => {
    const underscore = await booking(parents, { lead_guest_name: 'Wild_Card' });
    const plain = await booking(parents, { lead_guest_name: 'WildxCard' });
    const percent = await booking(parents, { lead_guest_name: 'Half%Off' });

    const byUnderscore = await reads.readHostBookings(
      owner(parents.hostId),
      parents.hostId,
      'wild_card',
    );
    const byPercent = await reads.readHostBookings(
      owner(parents.hostId),
      parents.hostId,
      '%',
    );

    expect(byUnderscore.bookings.map((b) => b.id)).toEqual([underscore]);
    expect(byUnderscore.bookings.map((b) => b.id)).not.toContain(plain);
    expect(byPercent.bookings.map((b) => b.id)).toEqual([percent]);
  });

  it('lists everything for a blank term', async () => {
    const all = await reads.readHostBookings(
      owner(parents.hostId),
      parents.hostId,
      '',
    );
    const blank = await reads.readHostBookings(
      owner(parents.hostId),
      parents.hostId,
      '   ',
    );
    expect(blank.bookings.map((b) => b.id)).toEqual(
      all.bookings.map((b) => b.id),
    );
  });

  it('refuses a term over the cap before reading', async () => {
    await expect(
      reads.readHostBookings(
        owner(parents.hostId),
        parents.hostId,
        'x'.repeat(101),
      ),
    ).rejects.toThrow();
  });

  it.each([
    ...notOwners,
    ['the owner of another host', () => owner(other.hostId)] as [
      string,
      () => Caller,
    ],
  ])('refuses %s', async (_name, caller) => {
    await expect(
      reads.readHostBookings(caller(), parents.hostId, ''),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets host staff of the host list the bookings', async () => {
    const staff = testCaller({
      roles: [Role.HostStaff],
      hostIds: [parents.hostId],
    });

    const data = await reads.readHostBookings(staff, parents.hostId, '');

    expect(data.bookings.length).toBeGreaterThan(0);
  });

  it('stops at the limit', async () => {
    // Run last: these fill the limit with the newest bookings.
    for (let n = 0; n < hostBookingListLimit + 2; n += 1) {
      const at = `2026-11-05T10:${String(n).padStart(2, '0')}:00Z`;
      await booking(parents, { created_at: at, confirmed_at: at });
    }
    const data = await reads.readHostBookings(
      owner(parents.hostId),
      parents.hostId,
      '',
    );
    expect(data.bookings).toHaveLength(hostBookingListLimit);
  });
});
