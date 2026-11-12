import { describe, expect, it } from 'vitest';
import {
  AddOneOffSessionInputSchema,
  CancelSessionInputSchema,
  UpdateSessionPriceInputSchema,
  UpdateSessionTimeInputSchema,
  checkUnbooked,
  planTemplateSeatChange,
  isUpcoming,
  localDateIn,
  occurrenceOn,
} from './sessions';

// Behaviours under test, one per decision, branch or risk:
// - a session moves or is cancelled only with no seats sold and no open hold; seats win over holds
// - a session that starts at this instant has started
// - one date's occurrence follows the DST rules the generator uses: the offset of that date, a
//   skipped time after the gap, a repeated time at the first
// - a stored instant reads back as the date it falls on in the session's own zone
// - the edit inputs take HH:MM and refuse every out-of-range field
// - a new seat cap on a template reaches the upcoming sessions that still carry the old cap, leaves
//   a hand-set one alone, and is refused whole when it would drop a following session under its
//   seats sold plus held

const id = '00000000-0000-4000-8000-000000000001';
const newYork = 'America/New_York';

describe('checkUnbooked', () => {
  it.each([
    ['nobody', 0, 0, { ok: true }],
    [
      'a seat sold',
      1,
      0,
      { ok: false, reason: 'has_bookings', seatsSold: 1, heldSeats: 0 },
    ],
    [
      'an open hold',
      0,
      2,
      { ok: false, reason: 'has_holds', seatsSold: 0, heldSeats: 2 },
    ],
    [
      'a seat sold and a hold',
      3,
      2,
      { ok: false, reason: 'has_bookings', seatsSold: 3, heldSeats: 2 },
    ],
  ])('%s', (_label, seatsSold, heldSeats, expected) => {
    expect(checkUnbooked(seatsSold, heldSeats)).toEqual(expected);
  });
});

describe('isUpcoming', () => {
  const now = new Date('2026-11-11T15:00:00.000Z');

  it.each([
    ['a millisecond ahead', '2026-11-11T15:00:00.001Z', true],
    ['this instant', '2026-11-11T15:00:00.000Z', false],
    ['earlier', '2026-11-11T14:59:59.999Z', false],
  ])('%s', (_label, startsAt, expected) => {
    expect(isUpcoming(new Date(startsAt), now)).toBe(expected);
  });
});

describe('occurrenceOn', () => {
  it('uses the offset of the date it is asked for, before and after spring forward', () => {
    expect(occurrenceOn('2026-03-07', '10:00:00', 60, newYork)).toEqual({
      localDate: '2026-03-07',
      startsAt: new Date('2026-03-07T15:00:00.000Z'),
      endsAt: new Date('2026-03-07T16:00:00.000Z'),
    });
    expect(occurrenceOn('2026-03-08', '10:00:00', 60, newYork)).toEqual({
      localDate: '2026-03-08',
      startsAt: new Date('2026-03-08T14:00:00.000Z'),
      endsAt: new Date('2026-03-08T15:00:00.000Z'),
    });
  });

  it('starts a skipped time after the gap and a repeated time at the first', () => {
    expect(
      occurrenceOn('2026-03-08', '02:30:00', 30, newYork).startsAt,
    ).toEqual(new Date('2026-03-08T07:30:00.000Z'));
    expect(
      occurrenceOn('2026-11-01', '01:30:00', 30, newYork).startsAt,
    ).toEqual(new Date('2026-11-01T05:30:00.000Z'));
  });

  it('refuses a date that is not real', () => {
    expect(() => occurrenceOn('2026-02-30', '10:00:00', 60, newYork)).toThrow(
      RangeError,
    );
  });
});

describe('localDateIn', () => {
  it.each([
    ['just before local midnight', '2026-11-14T04:59:00.000Z', '2026-11-13'],
    ['at local midnight', '2026-11-14T05:00:00.000Z', '2026-11-14'],
    [
      'late the evening before in UTC terms',
      '2026-11-15T03:00:00.000Z',
      '2026-11-14',
    ],
  ])('%s', (_label, instant, expected) => {
    expect(localDateIn(new Date(instant), newYork)).toBe(expected);
  });
});

describe('UpdateSessionTimeInputSchema', () => {
  const valid = {
    sessionId: id,
    startTime: '14:00',
    durationMinutes: 90,
    expectedVersion: 2,
  };

  it('stores seconds as 00', () => {
    expect(UpdateSessionTimeInputSchema.parse(valid).startTime).toBe(
      '14:00:00',
    );
  });

  it.each([
    ['a time past 23:59', { startTime: '24:00' }],
    ['a time with seconds', { startTime: '14:00:30' }],
    ['no length', { durationMinutes: 0 }],
    ['a length over a day', { durationMinutes: 1441 }],
    ['version 0', { expectedVersion: 0 }],
    ['an id that is not one', { sessionId: 'nope' }],
  ])('refuses %s', (_label, change) => {
    expect(
      UpdateSessionTimeInputSchema.safeParse({ ...valid, ...change }).success,
    ).toBe(false);
  });
});

describe('CancelSessionInputSchema', () => {
  it('needs the id and the version the host read', () => {
    expect(
      CancelSessionInputSchema.safeParse({ sessionId: id, expectedVersion: 1 })
        .success,
    ).toBe(true);
    expect(CancelSessionInputSchema.safeParse({ sessionId: id }).success).toBe(
      false,
    );
  });
});

describe('UpdateSessionPriceInputSchema', () => {
  const valid = { sessionId: id, kind: 'adult', priceMinor: 8500 };

  it.each([
    ['a free price', { priceMinor: 0 }, true],
    ['the largest price', { priceMinor: 10_000_000 }, true],
    ['a price over the largest', { priceMinor: 10_000_001 }, false],
    ['a negative price', { priceMinor: -1 }, false],
    ['a fractional price', { priceMinor: 12.5 }, false],
    ['a kind that does not exist', { kind: 'senior' }, false],
  ])('%s', (_label, change, ok) => {
    expect(
      UpdateSessionPriceInputSchema.safeParse({ ...valid, ...change }).success,
    ).toBe(ok);
  });
});

describe('AddOneOffSessionInputSchema', () => {
  const valid = {
    experienceId: id,
    localDate: '2026-11-21',
    startTime: '09:30',
    durationMinutes: 120,
    allocation: 6,
  };

  it('takes a real date and HH:MM', () => {
    expect(AddOneOffSessionInputSchema.parse(valid)).toMatchObject({
      localDate: '2026-11-21',
      startTime: '09:30:00',
    });
  });

  it.each([
    ['no seats', { allocation: 0 }],
    ['more seats than the limit', { allocation: 1001 }],
    ['a date that is not real', { localDate: '2026-02-30' }],
    ['a date in another shape', { localDate: '11/21/2026' }],
    ['a time that is not a time', { startTime: '9:30' }],
  ])('refuses %s', (_label, change) => {
    expect(
      AddOneOffSessionInputSchema.safeParse({ ...valid, ...change }).success,
    ).toBe(false);
  });
});

describe('planTemplateSeatChange', () => {
  const session = (
    name: string,
    allocation: number,
    seatsSold = 0,
    heldSeats = 0,
  ) => ({ id: name, allocation, seatsSold, heldSeats });

  it('moves the sessions that carry the old cap and leaves a hand-set one', () => {
    expect(
      planTemplateSeatChange(8, 12, [
        session('a', 8),
        session('edited', 10),
        session('b', 8, 3, 2),
      ]),
    ).toEqual({ ok: true, followIds: ['a', 'b'] });
  });

  it('has nothing to move when no session is upcoming', () => {
    expect(planTemplateSeatChange(8, 12, [])).toEqual({
      ok: true,
      followIds: [],
    });
  });

  it.each([
    ['exactly the seats sold and held', 5, 3, 2, true],
    ['one under the seats sold and held', 4, 3, 2, false],
    ['zero seats with nothing claimed', 0, 0, 0, true],
    ['zero seats with a seat sold', 0, 1, 0, false],
    ['zero seats with only a hold', 0, 0, 1, false],
  ])('a new cap of %s', (_label, cap, sold, held, allowed) => {
    expect(
      planTemplateSeatChange(8, cap, [session('a', 8, sold, held)]).ok,
    ).toBe(allowed);
  });

  it('refuses the whole change and names the most claimed seats', () => {
    expect(
      planTemplateSeatChange(8, 4, [
        session('a', 8, 5),
        session('b', 8, 2, 4),
        session('c', 8, 1),
      ]),
    ).toEqual({ ok: false, reason: 'below_sold_and_held', booked: 6 });
  });

  it('does not count a hand-set session against the new cap', () => {
    expect(planTemplateSeatChange(8, 4, [session('edited', 10, 7)]).ok).toBe(
      true,
    );
  });
});
