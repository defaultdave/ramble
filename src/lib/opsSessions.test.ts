import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  allocationNotice,
  buildOpsSessionRows,
  buildOpsSessionView,
  cancelBlocked,
  cancelGate,
  cancelOutcomeNotice,
  impactIsCurrent,
  impactOrders,
  impactView,
  openHeldSeatsBySession,
  opsSessionNoticeCodes,
  opsSessionNotices,
  parseAllocationForm,
  parseCancelForm,
  parsePauseForm,
  pauseCancelTargets,
  pauseOutcomeHref,
  pausePlanFor,
  pauseView,
  sessionNotice,
  parseSessionWhen,
  sessionImpact,
  sessionListDirection,
  type ImpactOrder,
  type OpsCancelOutcome,
  type SessionDetailRecord,
} from './opsSessions';
import {
  sessionAllocationChangedEntry,
  sessionsListEntry,
  sessionViewedEntry,
} from './sessionAudit';

// Behaviours under test, one per decision, branch, or risk:
// - the filter reads one known value; none, a repeated one, or an unknown one is every session
// - upcoming sessions list soonest first, the rest latest first
// - a row shows the start in the session's own zone, the seats, and the status in words
// - open holds are summed per session; a lapsed or finished hold takes no seats
// - payment attempts are attached to their own order
// - the impact refunds a confirmed booking by the refund's own arithmetic, tax included
// - a booking paid in part by a gift, and a confirmed booking with no single succeeded payment, block the cancellation, each named in its own words
// - an unpaid order counts as voided; an order that has already ended is left out
// - the fingerprint changes with the refunds, the unpaid orders, the held seats and the blocked bookings, and a form carrying the old one is not current
// - the impact reads in words (singular and plural, money, a closing period), lists at most 50 bookings, and names what blocks
// - a session has ended once it starts, and only a scheduled, not ended, unblocked session can be cancelled
// - the cancel form needs the id (lower-cased), an ops reason, a well-formed fingerprint, and the box ticked
// - every outcome names a notice, and every notice code has text
// - the audit rows pass the audit log's own parser and name the ops user, with ids only

const sessionId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const now = new Date('2026-11-10T12:00:00Z');
const tomorrow = new Date('2026-11-11T15:00:00Z');
const yesterday = new Date('2026-11-09T15:00:00Z');
const paid = [{ status: 'succeeded', providerPaymentId: 'pay_1' }];

const order = (over: Partial<ImpactOrder> = {}): ImpactOrder => ({
  reference: 'RMB-0001',
  status: 'confirmed',
  ticketSubtotalMinor: 10000,
  taxMinor: 800,
  totalMinor: 10800,
  amountDueMinor: 10800,
  commissionMinor: 1500,
  commissionRateBps: 1500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
  attempts: paid,
  ...over,
});

const hold = (over: Record<string, unknown> = {}) => ({
  sessionId,
  status: 'active' as const,
  seats: 2,
  expiresAt: new Date(now.getTime() + 60_000),
  payingUntil: null,
  ...over,
});

const form = (fields: Record<string, unknown>) => (name: string) =>
  fields[name] ?? null;

describe('parseSessionWhen and sessionListDirection', () => {
  it.each([
    ['upcoming', 'upcoming'],
    ['past', 'past'],
    [undefined, null],
    ['soon', null],
    [['upcoming', 'past'], null],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseSessionWhen(raw)).toBe(expected);
  });

  it.each([
    ['upcoming', 'asc'],
    ['past', 'desc'],
    [null, 'desc'],
  ] as const)('lists %j sessions %s', (when, direction) => {
    expect(sessionListDirection(when)).toBe(direction);
  });
});

describe('buildOpsSessionRows', () => {
  it('shows the start in the session zone, the seats, and the status in words', () => {
    const [row] = buildOpsSessionRows([
      {
        id: sessionId,
        experienceName: 'Harbor kayak',
        hostName: 'Tidewater',
        startsAt: new Date('2026-11-14T19:00:00Z'),
        timeZone: 'America/Los_Angeles',
        allocation: 12,
        seatsSold: 5,
        heldSeats: 2,
        status: 'cancelled',
      },
    ]);
    expect(row).toEqual({
      id: sessionId,
      href: `/ops/sessions/${sessionId}`,
      whenLabel: 'Sat, Nov 14, 11:00 AM PST',
      experienceName: 'Harbor kayak',
      hostName: 'Tidewater',
      sold: 5,
      held: 2,
      capacity: 12,
      statusLabel: 'Cancelled',
      statusTone: 'danger',
    });
  });
});

describe('openHeldSeatsBySession', () => {
  it('sums the open holds of each session and leaves out lapsed and finished ones', () => {
    const other = 'aaaaaaaa-4b5a-4697-8a9b-0c1d2e3f4a5b';
    const seats = openHeldSeatsBySession(
      [
        hold(),
        hold({
          seats: 3,
          status: 'paying',
          payingUntil: new Date(now.getTime() + 1000),
        }),
        hold({ expiresAt: new Date(now.getTime() - 1000) }),
        hold({ sessionId: other, seats: 4 }),
        hold({ sessionId: other, status: 'released' }),
      ],
      now,
    );
    expect(seats.get(sessionId)).toBe(5);
    expect(seats.get(other)).toBe(4);
    expect(openHeldSeatsBySession([], now).size).toBe(0);
  });
});

describe('impactOrders', () => {
  it('attaches each order its own payment attempts', () => {
    const plain = (reference: string) => ({
      ...order({ reference }),
      id: reference,
    });
    const [first, second] = [plain('RMB-1'), plain('RMB-2')];
    const result = impactOrders(
      [
        { ...first, id: 'a' },
        { ...second, id: 'b' },
      ],
      [
        { orderId: 'b', status: 'succeeded', providerPaymentId: 'pay_b' },
        { orderId: 'a', status: 'failed', providerPaymentId: null },
        { orderId: 'a', status: 'succeeded', providerPaymentId: 'pay_a' },
      ],
    );
    expect(result[0]?.attempts.map((a) => a.providerPaymentId)).toEqual([
      null,
      'pay_a',
    ]);
    expect(result[1]?.attempts).toHaveLength(1);
    expect(impactOrders([{ ...first, id: 'c' }], [])[0]?.attempts).toEqual([]);
  });
});

describe('sessionImpact', () => {
  it('refunds a confirmed booking in full, tax included', () => {
    expect(sessionImpact([order()], [], now).refunds).toEqual([
      { reference: 'RMB-0001', amountMinor: 10800 },
    ]);
  });

  it('refunds only what a part-refunded booking still holds', () => {
    const part = order({ refundedTicketMinor: 2500, refundedTaxMinor: 200 });
    expect(sessionImpact([part], [], now).refunds[0]?.amountMinor).toBe(8100);
  });

  it.each([
    ['paid in part by a gift', { amountDueMinor: 5000 }, 'gift'],
    ['with no succeeded payment', { attempts: [] }, 'no_payment'],
    [
      'with two succeeded payments',
      {
        attempts: [
          ...paid,
          { status: 'succeeded', providerPaymentId: 'pay_2' },
        ],
      },
      'no_payment',
    ],
    [
      'with nothing left to refund',
      { refundedTicketMinor: 10000, refundedTaxMinor: 800 },
      'other',
    ],
  ] as const)('blocks a booking %s', (_name, over, reason) => {
    const impact = sessionImpact(
      [order(), order({ reference: 'RMB-0002', ...over })],
      [],
      now,
    );
    expect(impact.blocked).toEqual([{ reference: 'RMB-0002', reason }]);
    expect(impact.refunds).toHaveLength(1);
    expect(cancelBlocked(impact)).toBe(true);
  });

  it('counts unpaid orders as voided, leaves ended ones out, and counts the holds and the open held seats', () => {
    const impact = sessionImpact(
      [
        order({ status: 'pending_payment' }),
        order({ status: 'payment_failed' }),
        order({ status: 'void' }),
        order({ status: 'cancelled' }),
        order({ status: 'refunded_after_lapse' }),
      ],
      [
        hold(),
        hold({ expiresAt: new Date(now.getTime() - 1000) }),
        hold({ seats: 1 }),
      ],
      now,
    );
    expect(impact).toEqual({
      refunds: [],
      blocked: [],
      unpaidCount: 2,
      openHolds: 3,
      heldSeats: 3,
    });
    expect(cancelBlocked(impact)).toBe(false);
  });
});

describe('the impact fingerprint and impactIsCurrent', () => {
  const base = sessionImpact([order()], [hold()], now);
  const fingerprintOf = (impact: ReturnType<typeof sessionImpact>) =>
    impactView(impact).fingerprint;

  it('writes the refund count and sum, the unpaid orders, the held seats, the holds and the blocked bookings', () => {
    expect(fingerprintOf(base)).toBe('1:10800:0:2:1:0');
  });

  it.each([
    [
      'another booking',
      sessionImpact([order(), order({ reference: 'R2' })], [hold()], now),
    ],
    [
      'a different refund amount',
      sessionImpact(
        [order({ refundedTicketMinor: 100, refundedTaxMinor: 8 })],
        [hold()],
        now,
      ),
    ],
    [
      'an unpaid order',
      sessionImpact(
        [order(), order({ status: 'pending_payment' })],
        [hold()],
        now,
      ),
    ],
    ['other held seats', sessionImpact([order()], [hold({ seats: 5 })], now)],
    [
      'one more hold released, though it holds no seats',
      sessionImpact(
        [order()],
        [hold(), hold({ expiresAt: new Date(now.getTime() - 1000) })],
        now,
      ),
    ],
    [
      'a blocked booking',
      sessionImpact([order(), order({ attempts: [] })], [hold()], now),
    ],
  ])('is no longer current after %s', (_name, changed) => {
    expect(impactIsCurrent(fingerprintOf(base), changed)).toBe(false);
  });

  it('is current when nothing changed', () => {
    expect(impactIsCurrent(fingerprintOf(base), base)).toBe(true);
  });
});

describe('impactView', () => {
  it('reads the totals in words, with a closing period', () => {
    const view = impactView(
      sessionImpact([order(), order({ reference: 'RMB-0002' })], [hold()], now),
    );
    expect(view.summary).toBe(
      '2 bookings refunded in full, $216.00 in all; 0 unpaid orders voided; 1 hold released.',
    );
    expect(view.bookings).toEqual([
      { reference: 'RMB-0001', amountLabel: '$108.00' },
      { reference: 'RMB-0002', amountLabel: '$108.00' },
    ]);
    expect(view.moreLabel).toBeNull();
    expect(view.blockedText).toBeNull();
    expect(view.fingerprint).toBe('2:21600:0:2:1:0');
  });

  it('says one booking in the singular', () => {
    expect(impactView(sessionImpact([order()], [], now)).summary).toMatch(
      /^1 booking refunded/,
    );
  });

  it('lists at most fifty bookings and counts the rest', () => {
    const many = Array.from({ length: 53 }, (_, n) =>
      order({ reference: `RMB-${String(n)}` }),
    );
    const view = impactView(sessionImpact(many, [], now));
    expect(view.bookings).toHaveLength(50);
    expect(view.moreLabel).toBe('and 3 more');
  });

  it('names each blocking booking and why, in plain words', () => {
    const view = impactView(
      sessionImpact(
        [
          order({ reference: 'RMB-9', amountDueMinor: 1 }),
          order({ reference: 'RMB-8', attempts: [] }),
        ],
        [],
        now,
      ),
    );
    expect(view.blockedText).toBe(
      'This cannot be cancelled here: RMB-9 paid in part by a gift; RMB-8 has no payment to send the money back to.',
    );
  });
});

describe('cancelGate and buildOpsSessionView', () => {
  const record = (
    over: Partial<SessionDetailRecord> = {},
  ): SessionDetailRecord => ({
    id: sessionId,
    experienceId: '9f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    experienceName: 'Harbor kayak',
    hostName: 'Tidewater',
    startsAt: tomorrow,
    timeZone: 'America/New_York',
    allocation: 12,
    seatsSold: 5,
    heldSeats: 2,
    status: 'scheduled',
    version: 3,
    ...over,
  });
  const clear = sessionImpact([order()], [], now);

  it.each([
    [tomorrow, 'ok'],
    [now, 'ended'],
    [yesterday, 'ended'],
  ] as const)(
    'a session starting %s is %s for cancelling',
    (startsAt, gate) => {
      expect(cancelGate({ startsAt }, now)).toBe(gate);
    },
  );

  it('reads a scheduled upcoming session with nothing blocking as cancellable', () => {
    expect(buildOpsSessionView(record(), now, clear)).toMatchObject({
      title: 'Harbor kayak, Wed, Nov 11, 10:00 AM EST',
      seatsLabel: '5 sold, 2 held, 12 capacity',
      canCancel: true,
      canEditCapacity: true,
      capacity: 12,
      minCapacity: 7,
      capacityHint: 'At least 7, the seats sold and held.',
      version: 3,
    });
  });

  it.each([
    ['started', { startsAt: yesterday }],
    ['cancelled', { status: 'cancelled' as const }],
    ['completed', { status: 'completed' as const }],
  ])('cannot cancel a %s session', (_name, over) => {
    const view = buildOpsSessionView(record(over), now, clear);
    expect(view.canCancel).toBe(false);
    expect(view.canEditCapacity).toBe(false);
  });

  it('cannot cancel while a booking blocks it', () => {
    const blocked = sessionImpact([order({ attempts: [] })], [], now);
    const view = buildOpsSessionView(record(), now, blocked);
    expect(view.canCancel).toBe(false);
    expect(view.canEditCapacity).toBe(true);
  });
});

describe('parseCancelForm', () => {
  const fields = {
    sessionId: sessionId.toUpperCase(),
    reason: 'weather',
    fingerprint: '1:10800:0:2:1:0',
    confirm: 'on',
  };

  it('reads the id (lower-cased), an ops reason, the fingerprint, and the box ticked', () => {
    expect(parseCancelForm(form(fields))).toEqual({
      ok: true,
      value: { sessionId, reason: 'weather', fingerprint: '1:10800:0:2:1:0' },
    });
  });

  it.each([
    ['the box not ticked', { confirm: undefined }],
    ['the host reason', { reason: 'host' }],
    ['no reason', { reason: undefined }],
    ['no id', { sessionId: undefined }],
    ['an id that is not one', { sessionId: 'x' }],
    ['no fingerprint', { fingerprint: undefined }],
    ['a fingerprint of the wrong shape', { fingerprint: '1:2:3' }],
    ['a fingerprint of the old shape', { fingerprint: '1:2:3:4:5' }],
    ['a fingerprint with letters', { fingerprint: '1:2:3:4:5:x' }],
    [
      'a fingerprint that is far too long',
      { fingerprint: `${'9'.repeat(5000)}:1:1:1:1` },
    ],
  ])('refuses a form with %s', (_name, over) => {
    expect(parseCancelForm(form({ ...fields, ...over }))).toEqual({
      ok: false,
    });
  });
});

describe('notices', () => {
  const done = (result: object) =>
    ({ kind: 'done', result }) as OpsCancelOutcome;
  const cancelled = { ordersRefunded: 1, ordersVoided: 0, holdsReleased: 0 };

  it.each([
    [{ kind: 'blocked' }, 'blocked'],
    [{ kind: 'stale' }, 'stale'],
    [{ kind: 'ended' }, 'in_the_past'],
    [done({ status: 'cancelled', ...cancelled, attemptsLeft: 0 }), 'cancelled'],
    [
      done({ status: 'cancelled', ...cancelled, attemptsLeft: 2 }),
      'cancelled_payments_left',
    ],
    [
      done({ status: 'already_cancelled', ...cancelled, attemptsLeft: 0 }),
      'already_cancelled',
    ],
    [done({ status: 'completed' }), 'completed'],
    [done({ status: 'not_found' }), 'not_found'],
  ] as [OpsCancelOutcome, string][])(
    'names the notice for outcome %#',
    (outcome, code) => {
      expect(cancelOutcomeNotice(outcome)).toBe(code);
    },
  );

  it('has text for every code, and reuses the host session wording for a missing or past session', () => {
    for (const code of opsSessionNoticeCodes) {
      expect(opsSessionNotices[code].title).not.toBe('');
    }
    expect(opsSessionNotices.in_the_past.title).toBe(
      'That time has already passed.',
    );
  });
});

describe('audit rows', () => {
  it('pass the audit log parser and name the ops user, with ids only', () => {
    const entries = [
      sessionsListEntry(userId),
      sessionViewedEntry(userId, sessionId),
    ];
    expect(entries.map((entry) => parseAuditEntry(entry).action)).toEqual([
      'sessions.list_viewed',
      'session.viewed',
    ]);
    expect(entries.every((entry) => entry.actorKind === 'user')).toBe(true);
    expect(entries[1]).toMatchObject({
      subjectKind: 'session',
      subjectId: sessionId,
    });
  });
});

// Behaviours under test, part B and C:
// - the pause form is read like the cancel form (id, fingerprint, the box); the capacity form like the host's
// - every capacity result names a notice, reusing the host session wording
// - the pause cancels future scheduled sessions with guests on them, and nothing else
// - an experience guests can see is paused, a paused one is finished, any other has nothing to pause
// - the pause section says what it cancels, is off while a booking blocks it, and on a paused experience cancels the rest
// - the pause sends the person back with the notice and the counts; the notice says how far it got only when the address carries both counts
// - the capacity change's audit row passes the audit log parser, and names the system when there is no user

describe('parsePauseForm', () => {
  const fields = { sessionId, fingerprint: '1:10800:0:2:0', confirm: 'on' };

  it('reads the id and the fingerprint, with the box ticked', () => {
    expect(parsePauseForm(form(fields))).toEqual({
      ok: true,
      value: { sessionId, fingerprint: '1:10800:0:2:0' },
    });
  });

  it.each([
    ['the box not ticked', { confirm: undefined }],
    ['no id', { sessionId: undefined }],
    ['no fingerprint', { fingerprint: undefined }],
    ['a fingerprint of the wrong shape', { fingerprint: 'abc' }],
  ])('refuses a form with %s', (_name, over) => {
    expect(parsePauseForm(form({ ...fields, ...over }))).toEqual({
      ok: false,
    });
  });
});

describe('parseAllocationForm', () => {
  it('reads a capacity form the way the host form is read', () => {
    expect(
      parseAllocationForm(
        form({ sessionId, allocation: '14', expectedVersion: '3' }),
      ),
    ).toEqual({
      ok: true,
      value: { sessionId, allocation: 14, expectedVersion: 3 },
    });
  });

  it.each([
    ['text for a capacity', { allocation: 'many', expectedVersion: '3' }],
    ['a capacity over the limit', { allocation: '1001', expectedVersion: '3' }],
    ['no version', { allocation: '14' }],
  ])('refuses a capacity form with %s', (_name, fields) => {
    expect(parseAllocationForm(form({ sessionId, ...fields }))).toEqual({
      ok: false,
    });
  });
});

describe('allocationNotice', () => {
  it.each([
    [{ ok: true }, 'allocation_saved'],
    [{ ok: false, reason: 'session_not_found' }, 'not_found'],
    [{ ok: false, reason: 'not_scheduled' }, 'not_scheduled'],
    [{ ok: false, reason: 'version_conflict' }, 'version_conflict'],
    [{ ok: false, reason: 'in_the_past' }, 'in_the_past'],
    [{ ok: false, reason: 'below_sold_and_held' }, 'below_sold_and_held'],
  ] as const)('names the notice for result %#', (result, code) => {
    expect(allocationNotice(result)).toBe(code);
  });
});

describe('pauseCancelTargets', () => {
  const target = (over: Record<string, unknown>) => ({
    id: sessionId,
    startsAt: tomorrow,
    status: 'scheduled' as const,
    seatsSold: 2,
    heldSeats: 0,
    ...over,
  });

  it('keeps a future scheduled session that has seats sold or held', () => {
    const sold = target({ id: 'sold' });
    const held = target({ id: 'held', seatsSold: 0, heldSeats: 1 });
    expect(pauseCancelTargets([sold, held], now)).toEqual([sold, held]);
  });

  it.each([
    ['one already started', { startsAt: yesterday }],
    ['one that starts now', { startsAt: now }],
    ['a cancelled one', { status: 'cancelled' as const }],
    ['a completed one', { status: 'completed' as const }],
    ['an empty one', { seatsSold: 0, heldSeats: 0 }],
  ])('drops %s', (_name, over) => {
    expect(pauseCancelTargets([target(over)], now)).toEqual([]);
  });
});

describe('pausePlanFor and pauseView', () => {
  it.each([
    ['live', 'pause'],
    ['guide_only', 'pause'],
    ['paused', 'finish'],
    ['draft', 'not_pausable'],
    ['in_review', 'not_pausable'],
  ] as const)('a %s experience is %s', (status, plan) => {
    expect(pausePlanFor(status)).toBe(plan);
  });

  const input = (over: Record<string, unknown> = {}) => ({
    experienceName: 'Harbor kayak',
    plan: 'pause' as const,
    targetCount: 3,
    impact: sessionImpact([order()], [], now),
    ...over,
  });

  it('says what pausing cancels, and is on while nothing blocks it', () => {
    expect(pauseView(input())).toMatchObject({
      explainer:
        'Hides Harbor kayak from guests, then cancels its future sessions that have guests and refunds their bookings.',
      sessionsLabel:
        '3 future sessions with guests on them would be cancelled.',
      buttonLabel: 'Pause experience and cancel its sessions',
      canPause: true,
    });
  });

  it('says one session in the singular and is off while a booking blocks it', () => {
    const view = pauseView(
      input({
        targetCount: 1,
        impact: sessionImpact([order({ attempts: [] })], [], now),
      }),
    );
    expect(view?.sessionsLabel).toMatch(/^1 future session with/);
    expect(view?.canPause).toBe(false);
    expect(view?.impact.blockedText).toMatch(/has no payment/);
  });

  it('on a paused experience offers to cancel the rest, even with a blocked booking among them, and is off with none left', () => {
    const blocked = sessionImpact([order({ attempts: [] })], [], now);
    expect(pauseView(input({ plan: 'finish', impact: blocked }))).toMatchObject(
      {
        buttonLabel: 'Cancel the remaining sessions',
        canPause: true,
      },
    );
    expect(pauseView(input({ plan: 'finish', targetCount: 0 }))?.canPause).toBe(
      false,
    );
  });

  it('is nothing for an experience with nothing to pause', () => {
    expect(pauseView(input({ plan: 'not_pausable' }))).toBeNull();
  });
});

describe('pauseOutcomeHref and sessionNotice', () => {
  const path = '/ops/sessions/x';

  it.each([
    [
      { status: 'paused', cancelled: 3, total: 3, left: 0 },
      `${path}?notice=paused&done=3&of=3`,
    ],
    [
      { status: 'paused', cancelled: 2, total: 3, left: 1 },
      `${path}?notice=paused_some_left&done=2&of=3`,
    ],
    [
      { status: 'incomplete', cancelled: 1, total: 3 },
      `${path}?notice=pause_incomplete&done=1&of=3`,
    ],
    [{ status: 'stale' }, `${path}?notice=stale`],
    [{ status: 'blocked' }, `${path}?notice=blocked`],
    [{ status: 'not_pausable' }, `${path}?notice=not_pausable`],
    [{ status: 'not_found' }, `${path}?notice=not_found`],
  ] as const)('sends outcome %# to %s', (outcome, href) => {
    expect(pauseOutcomeHref(path, outcome)).toBe(href);
  });

  it('says how far a progress notice got when the address carries both counts', () => {
    const notice = sessionNotice({
      notice: 'pause_incomplete',
      done: '1',
      of: '3',
    });
    expect(notice?.tone).toBe('danger');
    expect(notice?.title).toMatch(/^1 of 3 sessions cancelled\. /);
    expect(
      sessionNotice({ notice: 'paused_some_left', done: '2', of: '3' })?.title,
    ).toMatch(/^2 of 3 sessions cancelled\. /);
    expect(
      sessionNotice({ notice: 'paused_some_left', done: '1', of: '1' })?.title,
    ).toMatch(/^1 of 1 session cancelled\. /);
  });

  it.each([
    ['no counts', { notice: 'pause_incomplete' }],
    ['one count', { notice: 'pause_incomplete', done: '1' }],
    [
      'a count that is not a number',
      { notice: 'pause_incomplete', done: 'x', of: '3' },
    ],
    [
      'a count that is far too long',
      { notice: 'pause_incomplete', done: '1', of: '9'.repeat(40) },
    ],
  ])('falls back to the plain notice for %s', (_name, query) => {
    expect(sessionNotice(query)).toEqual(opsSessionNotices.pause_incomplete);
  });

  it('is nothing for no notice, an unknown one, or a repeated one, and leaves a plain notice alone', () => {
    expect(sessionNotice({})).toBeNull();
    expect(sessionNotice({ notice: 'nope' })).toBeNull();
    expect(sessionNotice({ notice: ['paused', 'stale'] })).toBeNull();
    expect(sessionNotice({ notice: 'paused', done: '3', of: '3' })).toEqual(
      opsSessionNotices.paused,
    );
  });
});

describe('the capacity change audit row', () => {
  it('passes the audit parser with the capacity before and after, and names the system for no user', () => {
    const entry = sessionAllocationChangedEntry({
      userId,
      sessionId,
      from: 10,
      to: 12,
    });
    expect(parseAuditEntry(entry)).toMatchObject({
      actorKind: 'user',
      action: 'session.allocation_changed',
      subjectKind: 'session',
      details: { from: 10, to: 12 },
    });
    expect(
      parseAuditEntry(
        sessionAllocationChangedEntry({
          userId: null,
          sessionId,
          from: 1,
          to: 2,
        }),
      ).actorKind,
    ).toBe('system');
  });
});
