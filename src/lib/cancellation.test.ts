import { describe, expect, it } from 'vitest';
import { cancellationWindow, MAX_FULL_REFUND_HOURS } from './cancellation';
import { PPM } from './pricing';

const NEW_YORK = 'America/New_York';
const hoursTier = (fullRefundHoursBefore: number) => ({
  fullRefundHoursBefore,
});
const at = (iso: string) => new Date(iso);
const FAR_BEFORE = at('2020-01-01T00:00:00Z');

function window(
  hours: number,
  startsAt: string,
  timeZone = NEW_YORK,
  now = FAR_BEFORE,
) {
  return cancellationWindow(hoursTier(hours), at(startsAt), now, timeZone);
}

describe('cancellationWindow deadline', () => {
  it('is the tier hours before the start, shown in the host zone', () => {
    const result = window(24, '2026-01-15T19:00:00Z');
    expect(result.freeCancelUntil).toEqual(at('2026-01-14T19:00:00Z'));
    expect(result.freeCancelUntilLocal).toEqual({
      date: '2026-01-14',
      time: '14:00',
      offset: '-05:00',
    });
  });

  it.each([
    ['flexible', 24, '2026-06-09T16:00:00Z'],
    ['moderate', 48, '2026-06-08T16:00:00Z'],
    ['strict', 168, '2026-06-03T16:00:00Z'],
    ['to the start', 0, '2026-06-10T16:00:00Z'],
  ])('follows the %s tier', (_name, hours, deadline) => {
    expect(window(hours, '2026-06-10T16:00:00Z').freeCancelUntil).toEqual(
      at(deadline),
    );
  });

  it.each([
    ['UTC', '2026-05-31', '12:00', '+00:00'],
    ['Asia/Kolkata', '2026-05-31', '17:30', '+05:30'],
    ['America/Los_Angeles', '2026-05-31', '05:00', '-07:00'],
  ])('writes the local time in %s', (zone, date, time, offset) => {
    expect(
      window(24, '2026-06-01T12:00:00Z', zone).freeCancelUntilLocal,
    ).toEqual({ date, time, offset });
  });

  it('truncates a deadline with seconds to the minute, never later than it is', () => {
    const result = window(0, '2026-06-01T12:00:59Z', 'UTC');
    expect(result.freeCancelUntilLocal.time).toBe('12:00');
  });

  it('reads midnight as 00:00, not 24:00', () => {
    expect(
      window(0, '2026-06-01T04:00:00Z').freeCancelUntilLocal,
    ).toMatchObject({
      date: '2026-06-01',
      time: '00:00',
    });
  });
});

describe('cancellationWindow across daylight saving', () => {
  it('spring forward: 24 hours before 10:00 the morning of the change is 09:00', () => {
    const result = window(24, '2026-03-08T14:00:00Z');
    expect(result.freeCancelUntil).toEqual(at('2026-03-07T14:00:00Z'));
    expect(result.freeCancelUntilLocal).toEqual({
      date: '2026-03-07',
      time: '09:00',
      offset: '-05:00',
    });
  });

  it('fall back: 24 hours before 10:00 the morning of the change is 11:00', () => {
    const result = window(24, '2026-11-01T15:00:00Z');
    expect(result.freeCancelUntil).toEqual(at('2026-10-31T15:00:00Z'));
    expect(result.freeCancelUntilLocal).toEqual({
      date: '2026-10-31',
      time: '11:00',
      offset: '-04:00',
    });
  });

  it('a start just after the skipped hour gives a deadline before it, not inside it', () => {
    // 03:30 EDT on 2026-03-08; one hour earlier by the clock would be 02:30, which does not exist.
    const result = window(1, '2026-03-08T07:30:00Z');
    expect(result.freeCancelUntilLocal).toEqual({
      date: '2026-03-08',
      time: '01:30',
      offset: '-05:00',
    });
  });

  it('never prints a time from the skipped hour for any tier length', () => {
    for (let hours = 0; hours <= 30; hours += 1) {
      const { freeCancelUntilLocal: local } = window(
        hours,
        '2026-03-08T07:30:00Z',
      );
      expect(local.date === '2026-03-08' && local.time.startsWith('02:')).toBe(
        false,
      );
    }
  });

  it('a deadline in the repeated hour reads with the offset of the pass it falls in', () => {
    // 01:30 happens twice on 2026-11-01, first at -04:00 and again at -05:00.
    const start = '2026-11-01T06:30:00Z';
    expect(window(0, start).freeCancelUntilLocal).toEqual({
      date: '2026-11-01',
      time: '01:30',
      offset: '-05:00',
    });
    expect(window(1, start).freeCancelUntilLocal).toEqual({
      date: '2026-11-01',
      time: '01:30',
      offset: '-04:00',
    });
    expect(window(2, start).freeCancelUntilLocal).toEqual({
      date: '2026-11-01',
      time: '00:30',
      offset: '-04:00',
    });
  });

  it('the two passes through the repeated hour are different instants an hour apart', () => {
    const start = '2026-11-01T06:30:00Z';
    const second = window(0, start).freeCancelUntil.getTime();
    const first = window(1, start).freeCancelUntil.getTime();
    expect(second - first).toBe(3_600_000);
  });

  it('a half-hour daylight saving change (Lord Howe) keeps the offset exact', () => {
    // Clocks go forward 30 minutes on 2026-10-04; 10:00 that day is +11:00, a day before it is +10:30.
    const result = window(24, '2026-10-03T23:00:00Z', 'Australia/Lord_Howe');
    expect(result.freeCancelUntilLocal).toEqual({
      date: '2026-10-03',
      time: '09:30',
      offset: '+10:30',
    });
  });

  it('is not moved by the machine time zone, only by the host zone given', () => {
    const start = '2026-03-08T14:00:00Z';
    expect(window(24, start, 'UTC').freeCancelUntilLocal.time).toBe('14:00');
    expect(window(24, start, NEW_YORK).freeCancelUntilLocal.time).toBe('09:00');
  });
});

describe('cancellationWindow refund', () => {
  const start = '2026-11-01T06:30:00Z';
  const deadline = at('2026-10-31T06:30:00Z');
  const tier = hoursTier(24);

  it('refunds in full well before the deadline', () => {
    const result = cancellationWindow(
      tier,
      at(start),
      at('2026-10-01T00:00:00Z'),
      NEW_YORK,
    );
    expect(result).toMatchObject({ isFree: true, refundPpm: PPM });
  });

  it('refunds in full at the deadline itself ("up to 24 hours before")', () => {
    const result = cancellationWindow(tier, at(start), deadline, NEW_YORK);
    expect(result).toMatchObject({ isFree: true, refundPpm: PPM });
  });

  it('refunds nothing one millisecond after the deadline', () => {
    const result = cancellationWindow(
      tier,
      at(start),
      new Date(deadline.getTime() + 1),
      NEW_YORK,
    );
    expect(result).toMatchObject({ isFree: false, refundPpm: 0 });
  });

  it('refunds nothing after the start, even on a zero-hour tier', () => {
    const afterStart = new Date(at(start).getTime() + 1);
    expect(
      cancellationWindow(hoursTier(0), at(start), afterStart, NEW_YORK),
    ).toMatchObject({ isFree: false, refundPpm: 0 });
    expect(
      cancellationWindow(hoursTier(0), at(start), at(start), NEW_YORK),
    ).toMatchObject({ isFree: true, refundPpm: PPM });
  });

  it('judges the deadline in elapsed time, so the repeated hour counts twice', () => {
    // Tier 0, start 01:30 EST (second pass). Now is 01:45 EDT (first pass), 45 minutes earlier: free.
    const now = at('2026-11-01T05:45:00Z');
    expect(
      cancellationWindow(hoursTier(0), at(start), now, NEW_YORK).isFree,
    ).toBe(true);
  });
});

describe('cancellationWindow refuses bad input', () => {
  const start = at('2026-06-10T16:00:00Z');
  const now = at('2026-06-01T00:00:00Z');

  it.each([
    -1,
    0.5,
    24.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    MAX_FULL_REFUND_HOURS + 1,
  ])('a tier of %s hours', (hours) => {
    expect(() =>
      cancellationWindow(hoursTier(hours), start, now, NEW_YORK),
    ).toThrow(RangeError);
  });

  it.each([
    ['an invalid start', new Date(Number.NaN), now],
    ['an invalid now', start, new Date(Number.NaN)],
    ['a start before 1970', new Date(-1), now],
    ['a start after year 9999', new Date(Date.UTC(10_000, 0, 1)), now],
    ['a now before 1970', start, new Date(-1)],
  ])('%s', (_name, startsAt, current) => {
    expect(() =>
      cancellationWindow(hoursTier(24), startsAt, current, NEW_YORK),
    ).toThrow(RangeError);
  });

  it('a deadline that falls before 1970', () => {
    expect(() =>
      cancellationWindow(hoursTier(24), new Date(3_600_000), now, NEW_YORK),
    ).toThrow(RangeError);
  });

  it.each([
    '',
    'Mars/Olympus',
    'Nowhere',
    '+05:00',
    '-0500',
    'UTC+5',
    ' America/New_York',
    'America/New_York ',
    'America//New_York',
    '../etc/passwd',
    'America/New_York/a/b',
    `America/${'x'.repeat(64)}`,
  ])('the time zone %j', (zone) => {
    expect(() => cancellationWindow(hoursTier(24), start, now, zone)).toThrow(
      RangeError,
    );
  });
});
