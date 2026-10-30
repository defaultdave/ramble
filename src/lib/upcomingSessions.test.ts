import { describe, expect, it } from 'vitest';
import { id } from './pages/experience.fixtures';
import {
  UpcomingSessionSchema,
  bookingRead,
  bookingSessionLimits,
  buildUpcomingSessions,
  listRead,
  requireBoundedRead,
  selectedDateFrom,
  upcomingSessionLimits,
  type SessionWithSpaces,
  type UpcomingSessionsInput,
} from './upcomingSessions';

// Behaviours under test, one per decision, branch or risk:
// - a row reads the date and time on the session's own clock, with the zone, not the server's
// - the spaces wording is open ("8 spaces"), few left ("3 left"), and sold out, and the status follows the same cut
// - a sold-out session stays listed, marked sold out, with no link; every other row links to booking
// - a session with no spaces figure (not visible to guests) is left out, and a list of only those is "none"
// - no sessions at all is "none"
// - the list reads 6 within 90 days and the booking choices 60 within 60; a read past those bounds, or not a whole number, is refused
// - the view never holds more than the row bound, in the order given
// - the price on each row is the card price: one price plain, two prices "From" the lowest, none when no option takes a space
// - the row whose date (on the session's calendar, not UTC) is the one in the address is selected, and no other
// - the address's date is read only when it is one real calendar date

const pageHref = '/experiences/sunset-kayak-1';
const at = (iso: string): SessionWithSpaces['session'] => ({
  id: id(10),
  startsAt: new Date(iso),
  timeZone: 'America/New_York',
});
const entry = (
  spacesLeft: number | null,
  iso = '2026-10-24T21:30:00Z',
  n = 10,
): SessionWithSpaces => ({
  session: { ...at(iso), id: id(n) },
  spacesLeft,
});
const input = (
  overrides: Partial<UpcomingSessionsInput> = {},
): UpcomingSessionsInput => ({
  sessions: [entry(8)],
  priceOptions: [{ priceMinor: 6500, usesSpace: true }],
  selectedDate: null,
  pageHref,
  ...overrides,
});
function rowsOf(view: ReturnType<typeof buildUpcomingSessions>) {
  if (view.kind !== 'rows') throw new Error('expected rows');
  return view.rows;
}

describe('buildUpcomingSessions', () => {
  it("reads the day and time on the session's own clock", () => {
    const [row] = rowsOf(
      buildUpcomingSessions(
        input({
          sessions: [entry(8, '2026-10-24T21:30:00Z')],
        }),
      ),
    );
    expect(row).toMatchObject({
      dayLabel: 'Sat, Oct 24',
      timeLabel: '5:30 PM EDT',
    });
    const [winter] = rowsOf(
      buildUpcomingSessions(
        input({ sessions: [entry(8, '2026-11-07T22:30:00Z')] }),
      ),
    );
    expect(winter).toMatchObject({
      dayLabel: 'Sat, Nov 7',
      timeLabel: '5:30 PM EST',
    });
  });

  it.each([
    [8, '8 spaces', 'open'],
    [4, '4 spaces', 'open'],
    [3, '3 left', 'few-left'],
    [1, '1 left', 'few-left'],
    [0, 'Sold out', 'sold-out'],
    [-2, 'Sold out', 'sold-out'],
  ])('words %i spaces left as %j (%s)', (left, label, status) => {
    const [row] = rowsOf(
      buildUpcomingSessions(input({ sessions: [entry(left)] })),
    );
    expect(row).toMatchObject({ spacesLabel: label, status });
  });

  it('keeps a sold-out session listed, without a link, and links the rest', () => {
    const rows = rowsOf(
      buildUpcomingSessions(
        input({
          sessions: [
            entry(0, undefined, 1),
            entry(2, undefined, 2),
            entry(9, undefined, 3),
          ],
        }),
      ),
    );
    expect(rows.map((row) => row.href)).toEqual([
      null,
      `${pageHref}?date=2026-10-24`,
      `${pageHref}?date=2026-10-24`,
    ]);
    expect(rows.map((row) => row.status)).toEqual([
      'sold-out',
      'few-left',
      'open',
    ]);
  });

  it('leaves out a session with no spaces figure', () => {
    const rows = rowsOf(
      buildUpcomingSessions(
        input({
          sessions: [entry(null, undefined, 1), entry(5, undefined, 2)],
        }),
      ),
    );
    expect(rows.map((row) => row.id)).toEqual([id(2)]);
  });

  it.each([[[]], [[entry(null)]]])('is "none" for %j', (sessions) => {
    expect(buildUpcomingSessions(input({ sessions }))).toEqual({
      kind: 'none',
    });
  });

  it('holds no more rows than the bound, in the order given', () => {
    const many = Array.from(
      { length: upcomingSessionLimits.maxRows + 3 },
      (_, n) => entry(5, undefined, n + 1),
    );
    const rows = rowsOf(buildUpcomingSessions(input({ sessions: many })));
    expect(rows.map((row) => row.id)).toEqual(
      many
        .slice(0, upcomingSessionLimits.maxRows)
        .map(({ session }) => session.id),
    );
  });

  it.each([
    [[{ priceMinor: 6500, usesSpace: true }], '$65'],
    [
      [
        { priceMinor: 6500, usesSpace: true },
        { priceMinor: 4500, usesSpace: true },
      ],
      'From $45',
    ],
    [[{ priceMinor: 0, usesSpace: false }], null],
  ])('prices each row from %j as %j', (priceOptions, priceLabel) => {
    const [row] = rowsOf(buildUpcomingSessions(input({ priceOptions })));
    expect(row?.priceLabel).toBe(priceLabel);
  });

  it("selects the rows on the address's date by the session's calendar, not UTC", () => {
    const sessions = [
      entry(5, '2026-10-24T21:30:00Z', 1),
      // 01:00 UTC on the 25th is still the 24th in New York.
      entry(5, '2026-10-25T01:00:00Z', 2),
      entry(5, '2026-10-25T15:00:00Z', 3),
    ];
    const rows = rowsOf(
      buildUpcomingSessions(input({ sessions, selectedDate: '2026-10-24' })),
    );
    expect(rows.map((row) => row.selected)).toEqual([true, true, false]);
  });

  it('selects nothing without a date in the address', () => {
    const rows = rowsOf(buildUpcomingSessions(input()));
    expect(rows.every((row) => !row.selected)).toBe(true);
  });
});

describe('selectedDateFrom', () => {
  it.each([
    [{ date: '2026-10-24' }, '2026-10-24'],
    [{}, null],
    [{ date: ['2026-10-24', '2026-10-25'] }, null],
    [{ date: '2026-02-30' }, null],
    [{ date: 'soon' }, null],
    [{ date: '' }, null],
    [{ day: '2026-10-24' }, null],
  ])('reads %j as %j', (params, expected) => {
    expect(selectedDateFrom(params)).toBe(expected);
  });
});

describe('UpcomingSessionSchema', () => {
  const valid = {
    id: id(1),
    startsAt: new Date('2026-10-24T21:30:00Z'),
    timeZone: 'America/New_York',
  };

  it('accepts a session with an ID, an instant, and an IANA zone', () => {
    expect(UpcomingSessionSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    { id: 'nope' },
    { startsAt: '2026-10-24' },
    { timeZone: 'Not a zone!' },
  ])('refuses %j', (override) => {
    expect(
      UpcomingSessionSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });
});

describe('session reads', () => {
  it('reads six within ninety days for the list, and sixty within sixty days for booking', () => {
    expect(listRead).toEqual({ limit: 6, windowDays: 90 });
    expect(bookingRead).toEqual({ limit: 60, windowDays: 60 });
    expect(() => {
      requireBoundedRead(listRead);
      requireBoundedRead(bookingRead);
    }).not.toThrow();
  });

  it.each([
    [0, 60],
    [61, 60],
    [1.5, 60],
    [Number.NaN, 60],
    [60, 0],
    [60, 91],
    [60, 2.5],
  ])('refuses a read of %s sessions in %s days', (limit, windowDays) => {
    expect(() => {
      requireBoundedRead({ limit, windowDays });
    }).toThrow(RangeError);
  });

  it('keeps the booking bound as wide as the widest read', () => {
    expect(bookingSessionLimits.maxSessions).toBe(60);
  });
});
