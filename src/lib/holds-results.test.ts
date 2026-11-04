import { describe, expect, it } from 'vitest';
import {
  ReserveResultSchema,
  alternativeWindow,
  blockedForBot,
  blockedForRateLimit,
  reserveBlock,
  spendsReserveTry,
  decideRelease,
  heldResult,
  pickAlternatives,
  type HoldTimes,
} from './holds';
import { at, later, active, uuid, otherUuid } from './holds.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - decideRelease: missing, another device's, another session's, and converted answer alike; paying is
//   refused; released answers released; active releases
// - alternatives: scheduled, after `at`, within 14 days, room for the whole party, soonest first, at
//   most three, spaces left counting only open holds

describe('results', () => {
  it('builds the held answer from the priced lines', () => {
    const lines = [
      {
        priceOptionId: otherUuid,
        kind: 'adult' as const,
        quantity: 2,
        unitPriceMinor: 5000,
        usesSpace: true,
        lineTotalMinor: 10_000,
      },
    ];
    const result = heldResult(
      { id: uuid, expiresAt: later(600_000) },
      { totalMinor: 10_888, lines },
    );

    expect(result).toEqual({
      status: 'held',
      holdId: uuid,
      expiresAt: '2026-11-01T12:10:00.000Z',
      totalMinor: 10_888,
      lines,
    });
    expect(ReserveResultSchema.safeParse(result).success).toBe(true);
  });

  it('blocks a bot without an end time and a rate-limited device with one', () => {
    expect(blockedForBot()).toEqual({
      status: 'blocked',
      reason: 'too_many_holds',
    });
    expect(blockedForRateLimit(90, at)).toEqual({
      status: 'blocked',
      reason: 'too_many_holds',
      until: '2026-11-01T12:01:30.000Z',
    });
  });

  it.each([
    ['a bot', 'bot', null, { status: 'blocked', reason: 'too_many_holds' }],
    [
      'a bot, whatever the limit says',
      'bot',
      { allowed: true, remaining: 3 },
      { status: 'blocked', reason: 'too_many_holds' },
    ],
    [
      'a person over the limit',
      'human',
      { allowed: false, retryAfterSeconds: 90 },
      {
        status: 'blocked',
        reason: 'too_many_holds',
        until: '2026-11-01T12:01:30.000Z',
      },
    ],
    [
      'a person within the limit',
      'human',
      { allowed: true, remaining: 3 },
      null,
    ],
    ['a person with no try spent', 'human', null, null],
  ] as const)('reserveBlock answers %s', (_name, verdict, tried, expected) => {
    expect(reserveBlock(verdict, tried, at)).toEqual(expected);
  });

  it.each([
    ['a bot', 'bot', false],
    ['a person', 'human', true],
  ] as const)('spendsReserveTry answers for %s', (_name, verdict, expected) => {
    expect(spendsReserveTry(verdict)).toBe(expected);
  });

  it.each([
    { status: 'sold_out', alternatives: [] },
    { status: 'blocked', reason: 'device_limit' },
    { status: 'unavailable', reason: 'gift_not_valid' },
    { status: 'invalid', fieldErrors: { items: 'party_size' } },
  ])('the contract schema accepts %j', (result) => {
    expect(ReserveResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    { status: 'sold_out' },
    { status: 'unavailable', reason: 'because' },
    { status: 'invalid', fieldErrors: { items: 'Quantity is too small' } },
    { status: 'held' },
  ])('the contract schema refuses %j', (result) => {
    expect(ReserveResultSchema.safeParse(result).success).toBe(false);
  });
});

describe('decideRelease', () => {
  const mine = { deviceKey: 'a'.repeat(64), sessionId: uuid };
  const hold = (status: HoldTimes['status'], overrides = {}) => ({
    status,
    ...mine,
    ...overrides,
  });
  const notFound = { release: false, result: { status: 'not_found' } };

  it.each([
    ['active', { release: true }],
    ['paying', { release: false, result: { status: 'payment_in_progress' } }],
    ['released', { release: false, result: { status: 'released' } }],
    ['converted', notFound],
  ] as const)('a %s hold of this device: %j', (status, expected) => {
    expect(decideRelease(hold(status), mine)).toEqual(expected);
  });

  it.each([
    ['missing', null],
    ['another device', hold('active', { deviceKey: 'b'.repeat(64) })],
    ['another session', hold('active', { sessionId: otherUuid })],
    ['another device, paying', hold('paying', { deviceKey: 'b'.repeat(64) })],
  ])('a hold that is %s answers not_found', (_name, subject) => {
    expect(decideRelease(subject, mine)).toEqual(notFound);
  });
});

describe('alternatives', () => {
  const day = 86_400_000;
  const candidate = (id: string, startsInMs: number, overrides = {}) => ({
    id,
    startsAt: later(startsInMs),
    timeZone: 'America/New_York',
    allocation: 10,
    seatsSold: 0,
    status: 'scheduled' as const,
    ...overrides,
  });
  const idsOf = (summaries: { sessionId: string }[]) =>
    summaries.map((s) => s.sessionId);

  it('spans from `at` to 14 days later', () => {
    expect(alternativeWindow(at)).toEqual({ from: at, until: later(14 * day) });
  });

  it('offers scheduled dates in the window with room for the party, soonest first', () => {
    const picked = pickAlternatives(
      [
        candidate('late', 9 * day),
        candidate('soon', day),
        candidate('cancelled', 2 * day, { status: 'cancelled' }),
        candidate('started', 0),
        candidate('begun', -day),
        candidate('too-far', 14 * day + 1),
        candidate('edge', 14 * day),
        candidate('full', 3 * day, { seatsSold: 9 }),
      ],
      [],
      2,
      at,
    );

    expect(idsOf(picked)).toEqual(['soon', 'late', 'edge']);
    expect(picked[0]).toEqual({
      sessionId: 'soon',
      startsAt: '2026-11-02T12:00:00.000Z',
      timeZone: 'America/New_York',
      spacesLeft: 10,
    });
  });

  it('counts open holds of that session only, and not lapsed ones', () => {
    const picked = pickAlternatives(
      [candidate('a', day), candidate('b', 2 * day)],
      [
        { ...active(later(1)), seats: 9, sessionId: 'a' },
        { ...active(at), seats: 9, sessionId: 'b' },
      ],
      2,
      at,
    );

    expect(idsOf(picked)).toEqual(['b']);
  });

  it('offers at most three', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      candidate(`s${String(index)}`, (index + 1) * day),
    );

    expect(idsOf(pickAlternatives(many, [], 1, at))).toEqual([
      's0',
      's1',
      's2',
    ]);
  });

  it('offers nothing when no date has room', () => {
    expect(
      pickAlternatives([candidate('a', day, { seatsSold: 10 })], [], 1, at),
    ).toEqual([]);
  });
});
