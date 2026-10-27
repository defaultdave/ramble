import { describe, expect, it } from 'vitest';
import {
  GenerateSessionsInputSchema,
  IsoDateSchema,
  SessionTemplateInputSchema,
  TimeZoneSchema,
  UpdateSessionAllocationInputSchema,
  checkAllocationChange,
  countAlreadyExisted,
  checkAllocationEditable,
  generationHorizon,
  isBeyondHorizon,
  isKnownTimeZone,
  maxAllocation,
  occurrencesBetween,
  requiresStaff,
  splitUpcoming,
} from './sessions';

// Behaviours under test, one per decision, branch or risk:
// - a weekly template lists exactly the dates on its weekday, both ends of the range included
// - the wall time holds across daylight saving in both directions, so the UTC start moves an hour
// - a time the zone skips starts after the gap, and a time it repeats starts at the first
// - the zone is the host's: the same wall time lands on different instants in different zones,
//   including a half-hour daylight saving shift
// - the end is the start plus the duration in elapsed minutes, even across a clock change
// - an empty or backwards range gives nothing; one over the cap, or a bad date, throws
// - every date in a range of the cap's length is listed once, with no drift across a leap year
// - a date is real, four digits and in range; a zone matches the pattern and Intl knows it
// - template input takes HH:MM, stores seconds as 00, and refuses every out-of-range field
// - the capacity check refuses a value under the seats sold and allows one equal to it
// - generation input refuses a range longer than the cap and a range that runs backwards
// - a range that ends on 9999-12-31, or is that one day, finishes with the right dates (adding
//   days clamps at year 9999, so a loop that waited for the end date would never stop)
// - the horizon is a year past now, clamped to 9999-12-29, and refuses a clock it cannot trust
// - at the clamped horizon, with the widest zone offsets and a 24-hour session, every start and
//   end stays inside the years the database CHECKs allow
// - dates are split into upcoming and past with a start equal to now counted as past, also
//   around a daylight saving gap; the existing count is attempted minus inserted
// - an allocation source is staff only; a Ramble source is the host's

const template = {
  weekday: 6,
  startTime: '10:00:00',
  durationMinutes: 120,
};
const newYork = 'America/New_York';

describe('occurrencesBetween', () => {
  it('lists each date on the weekday, both ends of the range included', () => {
    const dates = occurrencesBetween(
      template,
      newYork,
      '2026-06-06',
      '2026-06-20',
    ).map((occurrence) => occurrence.localDate);

    expect(dates).toEqual(['2026-06-06', '2026-06-13', '2026-06-20']);
  });

  it('starts from the first matching weekday inside the range', () => {
    const dates = occurrencesBetween(
      template,
      newYork,
      '2026-06-07',
      '2026-06-19',
    ).map((occurrence) => occurrence.localDate);

    expect(dates).toEqual(['2026-06-13']);
  });

  it('keeps the wall time across the spring-forward and fall-back changes', () => {
    const spring = occurrencesBetween(
      template,
      newYork,
      '2026-03-07',
      '2026-03-14',
    ).map((occurrence) => occurrence.startsAt.toISOString());
    const fall = occurrencesBetween(
      template,
      newYork,
      '2026-10-31',
      '2026-11-07',
    ).map((occurrence) => occurrence.startsAt.toISOString());

    expect(spring).toEqual([
      '2026-03-07T15:00:00.000Z',
      '2026-03-14T14:00:00.000Z',
    ]);
    expect(fall).toEqual([
      '2026-10-31T14:00:00.000Z',
      '2026-11-07T15:00:00.000Z',
    ]);
  });

  it.each([
    {
      name: 'a time the zone skips starts after the gap',
      weekday: 0,
      startTime: '02:30:00',
      range: ['2026-03-08', '2026-03-08'],
      expected: '2026-03-08T07:30:00.000Z',
    },
    {
      name: 'a time the zone repeats starts at the first of the two',
      weekday: 0,
      startTime: '01:30:00',
      range: ['2026-11-01', '2026-11-01'],
      expected: '2026-11-01T05:30:00.000Z',
    },
  ])('$name', ({ weekday, startTime, range, expected }) => {
    const [occurrence] = occurrencesBetween(
      { weekday, startTime, durationMinutes: 60 },
      newYork,
      range[0] ?? '',
      range[1] ?? '',
    );

    expect(occurrence?.startsAt.toISOString()).toBe(expected);
  });

  it.each([
    ['America/Los_Angeles', '2026-06-06T17:00:00.000Z'],
    ['Europe/London', '2026-06-06T09:00:00.000Z'],
    ['Australia/Lord_Howe', '2026-06-05T23:30:00.000Z'],
    ['Pacific/Auckland', '2026-06-05T22:00:00.000Z'],
    ['UTC', '2026-06-06T10:00:00.000Z'],
  ])('puts 10:00 on the wall of %s at %s', (zone, expected) => {
    const [occurrence] = occurrencesBetween(
      template,
      zone,
      '2026-06-06',
      '2026-06-06',
    );

    expect(occurrence?.startsAt.toISOString()).toBe(expected);
  });

  it('moves a half-hour daylight saving change by half an hour', () => {
    const [summer, winter] = occurrencesBetween(
      template,
      'Australia/Lord_Howe',
      '2026-01-03',
      '2026-06-06',
    ).filter((occurrence) =>
      ['2026-01-03', '2026-06-06'].includes(occurrence.localDate),
    );

    expect(summer?.startsAt.toISOString()).toBe('2026-01-02T23:00:00.000Z');
    expect(winter?.startsAt.toISOString()).toBe('2026-06-05T23:30:00.000Z');
  });

  it('ends after the duration in elapsed minutes, even across a clock change', () => {
    const [occurrence] = occurrencesBetween(
      { weekday: 0, startTime: '01:00:00', durationMinutes: 120 },
      newYork,
      '2026-03-08',
      '2026-03-08',
    );

    expect(occurrence?.startsAt.toISOString()).toBe('2026-03-08T06:00:00.000Z');
    expect(occurrence?.endsAt.toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });

  it('gives nothing for a range that runs backwards', () => {
    expect(
      occurrencesBetween(template, newYork, '2026-06-20', '2026-06-06'),
    ).toEqual([]);
  });

  it('lists every week of a range as long as the cap, with no repeat across a leap year', () => {
    const occurrences = occurrencesBetween(
      template,
      newYork,
      '2028-01-01',
      '2028-12-31',
    );
    const dates = occurrences.map((occurrence) => occurrence.localDate);

    expect(occurrences).toHaveLength(53);
    expect(new Set(dates).size).toBe(53);
    expect(dates.at(0)).toBe('2028-01-01');
    expect(dates.at(-1)).toBe('2028-12-30');
  });

  it.each([
    ['a range over the cap', '2028-01-01', '2029-01-01'],
    ['a date that is not real', '2026-02-30', '2026-03-10'],
    ['text that is not a date', 'soon', '2026-03-10'],
  ])('throws for %s', (_name, from, to) => {
    expect(() => occurrencesBetween(template, newYork, from, to)).toThrow(
      RangeError,
    );
  });

  it('throws for a zone it does not know', () => {
    expect(() =>
      occurrencesBetween(template, 'Nowhere/Land', '2026-06-06', '2026-06-06'),
    ).toThrow(RangeError);
  });
});

describe('occurrencesBetween at the end of year 9999', () => {
  const friday = { weekday: 5, startTime: '10:00:00', durationMinutes: 120 };

  it('finishes for a Friday template over a range that ends on 9999-12-31', () => {
    const dates = occurrencesBetween(
      friday,
      newYork,
      '9999-12-01',
      '9999-12-31',
    ).map((occurrence) => occurrence.localDate);

    expect(dates).toEqual([
      '9999-12-03',
      '9999-12-10',
      '9999-12-17',
      '9999-12-24',
      '9999-12-31',
    ]);
  });

  it('finishes for a one-day range on 9999-12-31, which is a Friday', () => {
    const [occurrence, ...rest] = occurrencesBetween(
      friday,
      newYork,
      '9999-12-31',
      '9999-12-31',
    );

    expect(rest).toEqual([]);
    expect(occurrence?.localDate).toBe('9999-12-31');
  });

  it.each([
    [6, '9999-12-25'],
    [0, '9999-12-26'],
    [1, '9999-12-27'],
    [2, '9999-12-28'],
    [3, '9999-12-29'],
    [4, '9999-12-30'],
  ])(
    'finishes for weekday %i over a range that ends on 9999-12-31',
    (weekday, expected) => {
      const occurrences = occurrencesBetween(
        { ...friday, weekday },
        newYork,
        '9999-12-25',
        '9999-12-31',
      );

      expect(occurrences.map((value) => value.localDate)).toEqual([expected]);
    },
  );

  it('gives nothing when the only matching weekday falls after the range', () => {
    expect(
      occurrencesBetween(friday, newYork, '9999-12-27', '9999-12-30'),
    ).toEqual([]);
  });
});

describe('generationHorizon', () => {
  it('is a year past now, as a UTC date', () => {
    expect(generationHorizon(new Date('2026-10-26T12:00:00Z'))).toBe(
      '2027-10-27',
    );
  });

  it('counts a leap day', () => {
    expect(generationHorizon(new Date('2027-10-26T00:00:00Z'))).toBe(
      '2028-10-26',
    );
  });

  it.each([
    '9998-12-30T00:00:00Z',
    '9999-06-01T00:00:00Z',
    '9999-12-29T00:00:00Z',
    '9999-12-31T23:59:59Z',
  ])('stops at 9999-12-29 for a clock of %s', (now) => {
    expect(generationHorizon(new Date(now))).toBe('9999-12-29');
  });

  it.each([
    ['an invalid date', new Date(Number.NaN)],
    ['a clock before year 1001', new Date('1000-12-31T23:59:59Z')],
  ])('throws for %s', (_name, now) => {
    expect(() => generationHorizon(now)).toThrow(RangeError);
  });

  it('accepts the first day of year 1001', () => {
    expect(generationHorizon(new Date('1001-01-01T00:00:00Z'))).toBe(
      '1002-01-02',
    );
  });

  it.each([
    'Pacific/Kiritimati',
    'Etc/GMT+12',
    'Pacific/Auckland',
    'America/New_York',
    'UTC',
  ])(
    'keeps a 23:59 start and a 24-hour session on the last date inside the stored years in %s',
    (zone) => {
      const [occurrence] = occurrencesBetween(
        { weekday: 3, startTime: '23:59:00', durationMinutes: 1440 },
        zone,
        '9999-12-29',
        '9999-12-29',
      );

      expect(occurrence?.localDate).toBe('9999-12-29');
      expect(occurrence?.endsAt.getTime()).toBeLessThan(Date.UTC(10000, 0, 1));
      expect(occurrence?.startsAt.getTime()).toBeGreaterThanOrEqual(
        Date.UTC(1000, 0, 1),
      );
    },
  );
});

describe('isBeyondHorizon', () => {
  const now = new Date('2026-10-26T12:00:00Z');

  it.each([
    ['the horizon day', '2027-10-27', false],
    ['the day after the horizon', '2027-10-28', true],
    ['today', '2026-10-26', false],
    ['a date in the past', '2020-01-01', false],
    ['year 9999', '9999-12-31', true],
  ])('%s (%s): %s', (_name, toDate, expected) => {
    expect(isBeyondHorizon(toDate, now)).toBe(expected);
  });

  it.each([
    ['9999-12-29', false],
    ['9999-12-30', true],
    ['9999-12-31', true],
  ])('with a clock in year 9999, %s: %s', (toDate, expected) => {
    expect(isBeyondHorizon(toDate, new Date('9999-12-15T00:00:00Z'))).toBe(
      expected,
    );
  });

  it('throws for a clock it cannot trust', () => {
    expect(() => isBeyondHorizon('2026-10-26', new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});

describe('splitUpcoming', () => {
  const [fifth, twelfth] = occurrencesBetween(
    template,
    newYork,
    '2026-06-06',
    '2026-06-13',
  );
  const occurrences = [fifth, twelfth].flatMap((value) => value ?? []);

  it('counts a start equal to now as past', () => {
    const { upcoming, inThePast } = splitUpcoming(
      occurrences,
      new Date('2026-06-06T14:00:00Z'),
    );

    expect(upcoming.map((value) => value.localDate)).toEqual(['2026-06-13']);
    expect(inThePast).toBe(1);
  });

  it('counts a start one millisecond after now as upcoming', () => {
    const { upcoming, inThePast } = splitUpcoming(
      occurrences,
      new Date('2026-06-06T13:59:59.999Z'),
    );

    expect(upcoming).toHaveLength(2);
    expect(inThePast).toBe(0);
  });

  it.each([
    [new Date('2026-06-01T00:00:00Z'), 2, 0],
    [new Date('2027-01-01T00:00:00Z'), 0, 2],
  ])('now %s: %i upcoming, %i past', (now, upcomingCount, past) => {
    const split = splitUpcoming(occurrences, now);

    expect(split.upcoming).toHaveLength(upcomingCount);
    expect(split.inThePast).toBe(past);
  });

  it('gives nothing for no occurrences', () => {
    expect(splitUpcoming([], new Date('2026-06-01T00:00:00Z'))).toEqual({
      upcoming: [],
      inThePast: 0,
    });
  });

  it('judges a time after a spring-forward gap by its real start', () => {
    const gap = occurrencesBetween(
      { weekday: 0, startTime: '02:30:00', durationMinutes: 60 },
      newYork,
      '2026-03-08',
      '2026-03-08',
    );

    expect(
      splitUpcoming(gap, new Date('2026-03-08T07:29:59.999Z')).upcoming,
    ).toHaveLength(1);
    expect(
      splitUpcoming(gap, new Date('2026-03-08T07:30:00.000Z')).upcoming,
    ).toHaveLength(0);
  });
});

describe('countAlreadyExisted', () => {
  it.each([
    [4, 4, 0],
    [4, 1, 3],
    [4, 0, 4],
    [0, 0, 0],
  ])(
    '%i attempted, %i inserted: %i existed',
    (attempted, inserted, existed) => {
      expect(countAlreadyExisted(attempted, inserted)).toBe(existed);
    },
  );
});

describe('IsoDateSchema', () => {
  it.each(['2026-06-06', '2028-02-29', '1000-01-01', '9999-12-31'])(
    'accepts %s',
    (value) => {
      expect(IsoDateSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each([
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '0999-01-01',
    '10000-01-01',
    '2026-6-6',
    '2026-06-06T00:00:00Z',
    '',
  ])('refuses %s', (value) => {
    expect(IsoDateSchema.safeParse(value).success).toBe(false);
  });
});

describe('time zones', () => {
  it.each([
    'America/New_York',
    'America/Argentina/Buenos_Aires',
    'America/Port-au-Prince',
    'Etc/GMT+5',
    'UTC',
  ])('accepts %s', (zone) => {
    expect(TimeZoneSchema.safeParse(zone).success).toBe(true);
    expect(isKnownTimeZone(zone)).toBe(true);
  });

  it.each([
    '',
    'EST',
    'UTC+3',
    'New York',
    'America/',
    '/New_York',
    'America/New_York; DROP',
    `America/${'a'.repeat(64)}`,
  ])('refuses the pattern for %s', (zone) => {
    expect(TimeZoneSchema.safeParse(zone).success).toBe(false);
  });

  it('matches the pattern for a name Intl does not know, and isKnownTimeZone refuses it', () => {
    expect(TimeZoneSchema.safeParse('Nowhere/Land').success).toBe(true);
    expect(isKnownTimeZone('Nowhere/Land')).toBe(false);
  });
});

describe('SessionTemplateInputSchema', () => {
  const valid = {
    experienceId: '11111111-1111-4111-8111-111111111111',
    weekday: 6,
    startTime: '10:00',
    durationMinutes: 90,
    allocation: 6,
    source: 'allocation',
  } as const;

  it('stores the start time with zero seconds', () => {
    expect(SessionTemplateInputSchema.parse(valid).startTime).toBe('10:00:00');
  });

  it.each([
    ['weekday', { weekday: 7 }],
    ['weekday', { weekday: -1 }],
    ['weekday', { weekday: 1.5 }],
    ['start time', { startTime: '24:00' }],
    ['start time', { startTime: '10:60' }],
    ['start time', { startTime: '10:00:30' }],
    ['start time', { startTime: '9:00' }],
    ['duration', { durationMinutes: 0 }],
    ['duration', { durationMinutes: 1441 }],
    ['allocation', { allocation: -1 }],
    ['allocation', { allocation: maxAllocation + 1 }],
    ['source', { source: 'external' }],
    ['experience', { experienceId: 'not-an-id' }],
  ])('refuses a %s of %j', (_field, override) => {
    expect(
      SessionTemplateInputSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });

  it('accepts an allocation of zero and the largest one', () => {
    expect(
      SessionTemplateInputSchema.safeParse({ ...valid, allocation: 0 }).success,
    ).toBe(true);
    expect(
      SessionTemplateInputSchema.safeParse({
        ...valid,
        allocation: maxAllocation,
      }).success,
    ).toBe(true);
  });
});

describe('GenerateSessionsInputSchema', () => {
  const templateId = '11111111-1111-4111-8111-111111111111';

  it.each([
    ['one day', '2026-06-06', '2026-06-06', true],
    ['the longest range', '2028-01-01', '2028-12-31', true],
    ['a range over the cap', '2028-01-01', '2029-01-01', false],
    ['a range that runs backwards', '2026-06-07', '2026-06-06', false],
    ['a date that is not real', '2026-02-30', '2026-03-01', false],
  ])('%s', (_name, fromDate, toDate, accepted) => {
    expect(
      GenerateSessionsInputSchema.safeParse({ templateId, fromDate, toDate })
        .success,
    ).toBe(accepted);
  });
});

describe('UpdateSessionAllocationInputSchema', () => {
  const valid = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    allocation: 4,
    expectedVersion: 1,
  };

  it.each([
    { allocation: -1 },
    { allocation: maxAllocation + 1 },
    { allocation: 2.5 },
    { expectedVersion: 0 },
    { sessionId: 'nope' },
  ])('refuses %j', (override) => {
    expect(
      UpdateSessionAllocationInputSchema.safeParse({ ...valid, ...override })
        .success,
    ).toBe(false);
  });

  it('accepts a valid edit', () => {
    expect(UpdateSessionAllocationInputSchema.safeParse(valid).success).toBe(
      true,
    );
  });
});

describe('checkAllocationEditable', () => {
  it.each([
    ['scheduled', true],
    ['cancelled', false],
    ['completed', false],
  ] as const)('%s: ok is %s', (status, ok) => {
    expect(checkAllocationEditable(status)).toEqual(
      ok ? { ok: true } : { ok: false, reason: 'not_scheduled' },
    );
  });
});

describe('checkAllocationChange', () => {
  it.each([
    { seatsSold: 5, allocation: 6, ok: true },
    { seatsSold: 5, allocation: 5, ok: true },
    { seatsSold: 0, allocation: 0, ok: true },
    { seatsSold: 5, allocation: 4, ok: false },
    { seatsSold: 5, allocation: 0, ok: false },
  ])(
    '$seatsSold sold, capacity $allocation: ok is $ok',
    ({ seatsSold, allocation, ok }) => {
      expect(checkAllocationChange(seatsSold, allocation).ok).toBe(ok);
    },
  );

  it('names the seats sold when it refuses', () => {
    expect(checkAllocationChange(5, 4)).toEqual({
      ok: false,
      reason: 'below_seats_sold',
      seatsSold: 5,
    });
  });
});

describe('requiresStaff', () => {
  it.each([
    ['ramble', false],
    ['allocation', true],
    ['external', true],
  ] as const)('%s: %s', (source, expected) => {
    expect(requiresStaff(source)).toBe(expected);
  });
});
