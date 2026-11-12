import { describe, expect, it } from 'vitest';
import {
  agesLabel,
  buildHostBookingList,
  buildHostGuestList,
  HostBookingSearchSchema,
  HostGuestListBookingSchema,
  hostBookingListLimit,
  hostBookingListResult,
  hostGuestListHref,
  hostGuestListResult,
  parseSessionId,
  waiverLabel,
  type HostBookingListRow,
  type HostGuestListData,
  type HostGuestListOwnerBooking,
} from './hostGuestLists';

// Behaviours under test, one per decision, branch or risk:
// - ages read as the children's ages, else the booker's confirmation, else "no age details"
// - the waiver reads accepted, not accepted (asked for and missing), or not required
// - a staff guest list has no children's ages or guardian fields at all, and keeps the contacts; an owner's shows them
// - a guest row carries party, ages, waiver, and email; the phone and guardian only when the booking holds them
// - the guest list totals seats and bookings, with the singular for one
// - a booking row links to its session's guest list and reads its status and time on the session's own clock
// - the summary says what a search found: matches, none, or the latest, and an empty host says no bookings
// - the list never draws more than the limit, whatever it is handed
// - the search term is trimmed and capped; a session id that is no id reads as null and a good one is lower-cased
// - signed out signs in; a non-owner or missing data is refused; an owner gets the view

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const bookingRow = (n: number, over: Partial<HostBookingListRow> = {}) => ({
  id: id(n),
  reference: `RMB-AAAA${String(n).padStart(2, '0')}`,
  leadGuestName: 'Ada Lovelace',
  experienceName: 'Sunset kayak',
  sessionId: id(100),
  sessionStartsAt: new Date('2026-11-15T21:00:00Z'),
  timeZone: 'America/New_York',
  seats: 2,
  status: 'confirmed' as const,
  ...over,
});

const guestData = (
  bookings: readonly HostGuestListOwnerBooking[],
  waiverRequired = true,
): HostGuestListData => ({
  scope: 'owner',
  session: {
    hostName: 'Harbor Kayak Co',
    id: id(100),
    experienceName: 'Sunset kayak',
    startsAt: new Date('2026-11-14T21:00:00Z'),
    timeZone: 'America/New_York',
    waiverRequired,
  },
  bookings,
});

const guestBooking = (over: Partial<HostGuestListOwnerBooking> = {}) => ({
  id: id(1),
  reference: 'RMB-AAAA01',
  leadGuestName: 'Ada Lovelace',
  seats: 2,
  ageConfirmed: null,
  childrenAges: null,
  guardianName: null,
  guardianContact: null,
  waiverAccepted: true,
  contactEmail: 'ada@example.com',
  contactPhone: null,
  ...over,
});

describe('agesLabel', () => {
  it.each([
    [[7], null, 'Child aged 7'],
    [[4, 9], true, 'Children aged 4, 9'],
    [null, true, 'All attendees confirmed of age'],
    [[], true, 'All attendees confirmed of age'],
    [null, false, 'No age details'],
    [null, null, 'No age details'],
  ] as const)('reads %j and %j as "%s"', (ages, confirmed, label) => {
    expect(agesLabel(ages, confirmed)).toBe(label);
  });
});

describe('a staff guest list', () => {
  it('has no guardian or ages, whatever the booking holds, and keeps the contacts', () => {
    const owner = guestData([
      guestBooking({
        childrenAges: [8, 11],
        guardianName: 'Ada Lovelace',
        guardianContact: 'ada@example.com',
        ageConfirmed: null,
        contactPhone: '+1 555 0100',
      }),
    ]);
    const staff = {
      ...owner,
      scope: 'staff' as const,
      bookings: HostGuestListBookingSchema.array().parse(owner.bookings),
    };

    const keys = Object.keys(staff.bookings[0] ?? {});
    expect(keys).not.toContain('childrenAges');
    expect(keys).not.toContain('guardianName');
    expect(keys).not.toContain('guardianContact');
    const row = buildHostGuestList(staff).rows[0];
    expect(row?.agesLabel).toBe('No age details');
    expect(row?.contacts.map((c) => c.label)).toEqual(['Email', 'Phone']);
  });

  it('shows an owner the children and the guardian', () => {
    const row = buildHostGuestList(
      guestData([
        guestBooking({
          childrenAges: [8, 11],
          guardianName: 'Ada Lovelace',
          guardianContact: 'ada@example.com',
        }),
      ]),
    ).rows[0];
    expect(row?.agesLabel).toBe('Children aged 8, 11');
    expect(row?.contacts.map((c) => c.label)).toContain('Guardian');
  });
});

describe('waiverLabel', () => {
  it.each([
    [true, true, 'Accepted'],
    [false, true, 'Accepted'],
    [true, false, 'Not accepted'],
    [false, false, 'Not required'],
  ] as const)('required %s, accepted %s reads "%s"', (r, a, label) => {
    expect(waiverLabel(r, a)).toBe(label);
  });
});

describe('buildHostGuestList', () => {
  it('draws each guest with party, ages, waiver, and email, and totals the seats', () => {
    const view = buildHostGuestList(
      guestData([
        guestBooking({ childrenAges: [8], seats: 3 }),
        guestBooking({
          id: id(2),
          reference: 'RMB-AAAA02',
          leadGuestName: 'Grace Hopper',
          seats: 1,
          waiverAccepted: false,
        }),
      ]),
    );
    expect(view.experienceName).toBe('Sunset kayak');
    expect(view.whenLabel).toBe('Sat, Nov 14 · 4:00 PM EST');
    expect(view.totalLabel).toBe('4 seats across 2 bookings');
    expect(view.rows[0]).toMatchObject({
      guestName: 'Ada Lovelace',
      seatsLabel: '3 seats',
      agesLabel: 'Child aged 8',
      waiverLabel: 'Accepted',
      contacts: [{ label: 'Email', value: 'ada@example.com' }],
    });
    expect(view.rows[1]).toMatchObject({
      seatsLabel: '1 seat',
      waiverLabel: 'Not accepted',
    });
  });

  it('adds the phone and the guardian only when the booking holds them', () => {
    const view = buildHostGuestList(
      guestData([
        guestBooking({
          contactPhone: '+1 555 0100',
          guardianName: 'Ada Lovelace',
          guardianContact: 'ada@example.com',
          childrenAges: [8],
        }),
      ]),
    );
    expect(view.rows[0]?.contacts).toEqual([
      { label: 'Email', value: 'ada@example.com' },
      { label: 'Phone', value: '+1 555 0100' },
      { label: 'Guardian', value: 'Ada Lovelace, ada@example.com' },
    ]);
  });

  it('says no waiver is required when the experience asks for none', () => {
    const view = buildHostGuestList(
      guestData([guestBooking({ waiverAccepted: false })], false),
    );
    expect(view.rows[0]?.waiverLabel).toBe('Not required');
  });

  it('totals one booking of one seat in the singular', () => {
    const view = buildHostGuestList(guestData([guestBooking({ seats: 1 })]));
    expect(view.totalLabel).toBe('1 seat across 1 booking');
  });

  it('totals nothing for a session without bookings', () => {
    const view = buildHostGuestList(guestData([]));
    expect(view.rows).toEqual([]);
    expect(view.totalLabel).toBe('0 seats across 0 bookings');
  });
});

describe('buildHostBookingList', () => {
  it('links a booking to its session and reads its time and status', () => {
    const view = buildHostBookingList(
      {
        bookings: [
          bookingRow(1),
          bookingRow(2, { status: 'cancelled', seats: 1 }),
        ],
      },
      '',
    );
    expect(view.rows[0]).toMatchObject({
      guestName: 'Ada Lovelace',
      details: [
        'Sunset kayak · Sun, Nov 15 · 4:00 PM EST',
        '2 seats · Confirmed · RMB-AAAA01',
      ],
      guestListHref: hostGuestListHref(id(100)),
    });
    expect(view.rows[1]?.details[1]).toMatch(/^1 seat · Cancelled · RMB-/);
    expect(view.summary).toBe('Latest 2 bookings');
  });

  it.each([
    [1, 'ada', '1 booking matches “ada”'],
    [3, 'ada', '3 bookings match “ada”'],
    [0, 'zed', 'No bookings match “zed”'],
    [0, '', 'No bookings yet'],
    [1, '', 'Latest 1 booking'],
  ])('says what %d rows for "%s" are', (count, term, summary) => {
    const bookings = Array.from({ length: count }, (_, n) => bookingRow(n + 1));
    expect(buildHostBookingList({ bookings }, term).summary).toBe(summary);
  });

  it('never draws more rows than the limit', () => {
    const bookings = Array.from({ length: hostBookingListLimit + 5 }, (_, n) =>
      bookingRow(n + 1),
    );
    expect(buildHostBookingList({ bookings }, '').rows).toHaveLength(
      hostBookingListLimit,
    );
  });
});

describe('HostBookingSearchSchema and parseSessionId', () => {
  it('trims the term and refuses one over the cap', () => {
    expect(HostBookingSearchSchema.parse('  ada  ')).toBe('ada');
    expect(() => HostBookingSearchSchema.parse('x'.repeat(101))).toThrow();
  });

  it('reads a session id lower-cased, and anything else as null', () => {
    expect(parseSessionId(id(100).toUpperCase())).toBe(id(100));
    expect(parseSessionId('not-an-id')).toBeNull();
    expect(parseSessionId('')).toBeNull();
  });
});

describe('the results', () => {
  const owner = { kind: 'owner', hostId: id(9) } as const;
  const data = { bookings: [bookingRow(1)] };

  it('sends nobody signed in to sign in, before looking at the data', () => {
    expect(hostBookingListResult({ kind: 'signed_out' }, null, '')).toEqual({
      status: 'signed_out',
    });
    expect(hostGuestListResult({ kind: 'signed_out' }, null)).toEqual({
      status: 'signed_out',
    });
  });

  it('refuses a signed-in non-owner even when data is handed over', () => {
    expect(hostBookingListResult({ kind: 'no_host_role' }, data, '')).toEqual({
      status: 'refused',
    });
    expect(
      hostGuestListResult({ kind: 'no_host_role' }, guestData([])),
    ).toEqual({ status: 'refused' });
  });

  it('refuses an owner with no data: a missing host, or a session that is missing or another host’s', () => {
    expect(hostBookingListResult(owner, null, '')).toEqual({
      status: 'refused',
    });
    expect(hostGuestListResult(owner, null)).toEqual({ status: 'refused' });
  });

  it.each([
    ['an owner', owner],
    ['host staff', { kind: 'staff', hostId: id(9) } as const],
  ])('gives %s the view', (_name, access) => {
    const list = hostBookingListResult(access, data, 'ada');
    expect(list.status === 'ok' && list.view.term).toBe('ada');
    const guests = hostGuestListResult(access, guestData([]));
    expect(guests.status === 'ok' && guests.view.hostName).toBe(
      'Harbor Kayak Co',
    );
  });
});
