import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import type { CancelFacts } from './cancelBooking';
import { capabilityTokenKinds } from './capabilityTokens';
import { experienceStatuses } from './catalog';
import { sessionStatuses } from './sessions';
import {
  GuestMovePayloadSchema,
  isMovable,
  moveAuditEntry,
  moveCacheChanges,
  moveChoices,
  moveInputFromForm,
  movePlan,
  moveStart,
  parseMoveInput,
  type MoveSubject,
  type MoveTarget,
} from './moveBooking';

// Behaviours under test, one per decision, branch, or risk:
// - a booking is movable exactly while a cancel would refund it in full: the deadline minute is in, one millisecond after is out;
//   a gift-paid, cancelled, started, other-kind, unconfirmed, or fully refunded booking is out
// - a date is refused, each with its own answer: none, the booking's own, another experience's, one that is not scheduled, one of an
//   experience that is not live, one that has started; then one with too few spaces (the party exactly fits, one fewer does not);
//   then one inside the booking's own window (the deadline minute is in, one millisecond inside is out)
// - the new deadline is the booking's tier before the new start, not the old one carried over
// - the plan answers not found before anything else for a missing booking or a stale token, then not movable, then the date
// - the lock list is the two sessions in id order whichever way round they are, one when they are the same, and only a manage token starts it
// - the audit row passes the audit parser with ids and counts only; only a plan that proceeds changes spaces
// - the picker lists exactly the dates the verdict accepts, in the order read

const now = new Date('2026-11-05T12:00:00.000Z');
const hoursMs = 3_600_000;
const tierHours = 24;

const facts: CancelFacts = {
  status: 'confirmed',
  kind: 'booking',
  ticketSubtotalMinor: 13_000,
  taxMinor: 0,
  totalMinor: 13_000,
  amountDueMinor: 13_000,
  commissionMinor: 1_950,
  commissionRateBps: 1_500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
  giftAppliedMinor: 0,
  freeCancelUntil: new Date(now.getTime() + 60_000),
  manageTokenVersion: 1,
  sessionStartsAt: new Date(now.getTime() + 3 * hoursMs),
  seats: 2,
};

const subject: MoveSubject = {
  facts,
  sessionId: 'a0000000-0000-4000-8000-0000000000aa',
  experienceId: 'e0000000-0000-4000-8000-0000000000ee',
  experienceStatus: 'live',
  fullRefundHoursBefore: tierHours,
};

/** A date that starts `hoursAhead` hours after `now`, with room for the party. */
function dateIn(
  hoursAhead: number,
  over: Partial<MoveTarget> = {},
): MoveTarget {
  return {
    id: 'b0000000-0000-4000-8000-0000000000bb',
    experienceId: subject.experienceId,
    status: 'scheduled',
    startsAt: new Date(now.getTime() + hoursAhead * hoursMs),
    timeZone: 'America/New_York',
    spacesLeft: 5,
    ...over,
  };
}

/** The date's verdict, read through the plan of a booking that is inside the terms. */
const verdict = (
  target: MoveTarget | null,
  over: Partial<MoveSubject> = {},
) => {
  const plan = movePlan({
    subject: { ...subject, ...over },
    target,
    openedTokenVersion: 1,
    now,
  });
  return plan.kind === 'proceed'
    ? ({ kind: 'ok', freeCancelUntil: plan.freeCancelUntil } as const)
    : ({ kind: 'refused', refusal: plan.result.status } as const);
};

describe('isMovable', () => {
  it('is true inside the window', () => {
    expect(isMovable(facts, now)).toBe(true);
  });

  it.each([
    ['the deadline minute itself', 0, true],
    ['one millisecond after the deadline', 1, false],
  ])('at %s', (_name, afterDeadlineMs, movable) => {
    const at = new Date(
      (facts.freeCancelUntil as Date).getTime() + afterDeadlineMs,
    );

    expect(isMovable(facts, at)).toBe(movable);
  });

  it.each([
    ['cancelled', { status: 'cancelled' }],
    ['pending payment', { status: 'pending_payment' }],
    ['a gift purchase', { kind: 'gift_purchase' }],
    ['paid with a gift', { giftAppliedMinor: 1 }],
    ['with no deadline', { freeCancelUntil: null }],
    [
      'fully refunded already',
      { refundedTicketMinor: 13_000, commissionReturnedMinor: 1_950 },
    ],
    ['started', { sessionStartsAt: now }],
  ] as [string, Partial<CancelFacts>][])('is false when %s', (_name, over) => {
    expect(isMovable({ ...facts, ...over }, now)).toBe(false);
  });

  it('is true when the session starts one millisecond from now', () => {
    expect(
      isMovable(
        { ...facts, sessionStartsAt: new Date(now.getTime() + 1) },
        now,
      ),
    ).toBe(true);
  });
});

describe('the verdict on a date, through movePlan', () => {
  it('accepts a later date of the same experience and carries the new deadline', () => {
    const target = dateIn(72);

    expect(verdict(target)).toEqual({
      kind: 'ok',
      freeCancelUntil: new Date(
        target.startsAt.getTime() - tierHours * hoursMs,
      ),
    });
  });

  it('makes the deadline from the booking tier, not from the old deadline', () => {
    const target = dateIn(72);

    expect(verdict(target, { fullRefundHoursBefore: 48 })).toMatchObject({
      kind: 'ok',
      freeCancelUntil: new Date(target.startsAt.getTime() - 48 * hoursMs),
    });
  });

  it.each([
    ['no date', null, 'date_unavailable'],
    [
      'the booking own date',
      dateIn(72, { id: subject.sessionId }),
      'same_date',
    ],
    [
      'a date of another experience',
      dateIn(72, { experienceId: 'e0000000-0000-4000-8000-0000000000ef' }),
      'date_unavailable',
    ],
    [
      'the booking own date of another experience',
      dateIn(72, {
        id: subject.sessionId,
        experienceId: 'e0000000-0000-4000-8000-0000000000ef',
      }),
      'same_date',
    ],
    ['a date that has started', dateIn(-1), 'date_unavailable'],
    ['a date that starts right now', dateIn(0), 'date_unavailable'],
  ])('refuses %s as %s', (_name, target, refusal) => {
    expect(verdict(target)).toEqual({ kind: 'refused', refusal });
  });

  it.each(sessionStatuses.filter((status) => status !== 'scheduled'))(
    'refuses a date that is %s, even with no spaces, as unavailable',
    (status) => {
      expect(verdict(dateIn(72, { status, spacesLeft: 0 }))).toEqual({
        kind: 'refused',
        refusal: 'date_unavailable',
      });
    },
  );

  it.each(experienceStatuses.filter((status) => status !== 'live'))(
    'refuses a date of an experience that is %s',
    (experienceStatus) => {
      expect(verdict(dateIn(72), { experienceStatus })).toEqual({
        kind: 'refused',
        refusal: 'date_unavailable',
      });
    },
  );

  it.each([
    ['exactly the party', 2, 'ok'],
    ['one fewer than the party', 1, 'sold_out'],
    ['none', 0, 'sold_out'],
    ['less than none, after a lowered capacity', -3, 'sold_out'],
  ])('with %s of spaces left', (_name, spacesLeft, kind) => {
    expect(verdict(dateIn(72, { spacesLeft })).kind).toBe(
      kind === 'ok' ? 'ok' : 'refused',
    );
    if (kind === 'sold_out') {
      expect(verdict(dateIn(72, { spacesLeft }))).toEqual({
        kind: 'refused',
        refusal: 'sold_out',
      });
    }
  });

  it.each([
    ['exactly the tier before the start', tierHours * hoursMs, 'ok'],
    ['one millisecond inside the tier', tierHours * hoursMs - 1, 'too_soon'],
    ['one millisecond outside the tier', tierHours * hoursMs + 1, 'ok'],
  ])('a date that starts %s', (_name, aheadMs, expected) => {
    const target = dateIn(0, { startsAt: new Date(now.getTime() + aheadMs) });

    const answer = verdict(target);

    expect(answer.kind === 'ok' ? 'ok' : answer.refusal).toBe(expected);
  });

  it('judges the date before its space: a cancelled date with no room is unavailable, a full date inside the tier is full', () => {
    expect(
      verdict(dateIn(1, { spacesLeft: 0, status: 'cancelled' })),
    ).toMatchObject({ refusal: 'date_unavailable' });
    expect(verdict(dateIn(1, { spacesLeft: 0 }))).toMatchObject({
      refusal: 'sold_out',
    });
  });

  it('judges in the booking own tier of zero hours: any date still ahead is movable to', () => {
    expect(verdict(dateIn(0.001), { fullRefundHoursBefore: 0 }).kind).toBe(
      'ok',
    );
  });
});

describe('movePlan', () => {
  const plan = (over: Partial<Parameters<typeof movePlan>[0]> = {}) =>
    movePlan({
      subject,
      target: dateIn(72),
      openedTokenVersion: 1,
      now,
      ...over,
    });

  it('proceeds with the sessions, the seats, and the new deadline', () => {
    const target = dateIn(72);

    expect(plan({ target })).toEqual({
      kind: 'proceed',
      fromSessionId: subject.sessionId,
      toSessionId: target.id,
      seats: 2,
      freeCancelUntil: new Date(
        target.startsAt.getTime() - tierHours * hoursMs,
      ),
    });
  });

  it.each([
    ['no booking', { subject: null }],
    ['a token from before a bump', { openedTokenVersion: 2 }],
    [
      'a token from before a bump, even for a booking outside the terms',
      {
        subject: {
          ...subject,
          facts: { ...facts, status: 'cancelled' as const },
        },
        openedTokenVersion: 3,
      },
    ],
  ])('answers not found for %s', (_name, over) => {
    expect(plan(over)).toEqual({
      kind: 'stop',
      result: { status: 'not_found' },
    });
  });

  it('answers not movable before it looks at the date', () => {
    expect(
      plan({
        subject: { ...subject, facts: { ...facts, giftAppliedMinor: 5 } },
        target: null,
      }),
    ).toEqual({ kind: 'stop', result: { status: 'not_movable' } });
  });

  it.each([
    ['same_date', dateIn(72, { id: subject.sessionId })],
    ['date_unavailable', null],
    ['sold_out', dateIn(72, { spacesLeft: 1 })],
    ['too_soon', dateIn(2)],
  ])('answers %s for a date the verdict refuses so', (status, target) => {
    expect(plan({ target })).toEqual({ kind: 'stop', result: { status } });
  });
});

describe('moveStart', () => {
  const ids = {
    sessionId: 'b0000000-0000-4000-8000-0000000000bb',
    holdId: 'c0000000-0000-4000-8000-0000000000cc',
  };
  const lowerId = 'a0000000-0000-4000-8000-0000000000aa';
  const higherId = 'f0000000-0000-4000-8000-0000000000ff';

  it.each([
    ['the booking session is the lower', lowerId, higherId],
    ['the booking session is the higher', higherId, lowerId],
  ])('locks both sessions in id order when %s', (_name, from, to) => {
    expect(
      moveStart({
        tokenKind: 'manage',
        ids: { ...ids, sessionId: from },
        targetSessionId: to,
      }),
    ).toEqual({
      kind: 'lock',
      sessionIds: [lowerId, higherId],
      fromSessionId: from,
      holdId: ids.holdId,
    });
  });

  it('locks one session when the date chosen is the booking own', () => {
    expect(
      moveStart({ tokenKind: 'manage', ids, targetSessionId: ids.sessionId }),
    ).toMatchObject({ kind: 'lock', sessionIds: [ids.sessionId] });
  });

  it.each(capabilityTokenKinds.filter((kind) => kind !== 'manage'))(
    'stops for a %s token',
    (tokenKind) => {
      expect(moveStart({ tokenKind, ids, targetSessionId: lowerId })).toEqual({
        kind: 'stop',
        result: { status: 'not_found' },
      });
    },
  );

  it.each([
    ['no order', null],
    ['an order with no session', { ...ids, sessionId: null }],
    ['an order with no hold', { ...ids, holdId: null }],
  ])('stops for %s', (_name, orderIds) => {
    expect(
      moveStart({
        tokenKind: 'manage',
        ids: orderIds,
        targetSessionId: lowerId,
      }),
    ).toEqual({ kind: 'stop', result: { status: 'not_found' } });
  });
});

describe('the audit row and the cache changes', () => {
  const entry = moveAuditEntry({
    orderId: '0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01',
    fromSessionId: subject.sessionId,
    toSessionId: 'b0000000-0000-4000-8000-0000000000bb',
    seats: 2,
  });

  it('is a guest action on the order with ids and a count', () => {
    expect(entry).toEqual({
      actorKind: 'guest',
      action: 'order.moved',
      subjectKind: 'order',
      subjectId: '0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01',
      details: {
        from_session_id: subject.sessionId,
        to_session_id: 'b0000000-0000-4000-8000-0000000000bb',
        seats_moved: 2,
      },
    });
  });

  it('passes the audit parser', () => {
    expect(() => parseAuditEntry(entry)).not.toThrow();
  });

  it('invalidates the spaces of both dates for a plan that proceeds, and nothing for one that stops', () => {
    expect(
      moveCacheChanges({
        kind: 'proceed',
        fromSessionId: 'x',
        toSessionId: 'y',
        seats: 1,
        freeCancelUntil: now,
      }),
    ).toEqual([
      { kind: 'spaces', sessionId: 'x' },
      { kind: 'spaces', sessionId: 'y' },
    ]);
    expect(
      moveCacheChanges({ kind: 'stop', result: { status: 'sold_out' } }),
    ).toEqual([]);
  });
});

describe('the input', () => {
  const token = 'A'.repeat(43);
  const targetSessionId = 'B0000000-0000-4000-8000-0000000000BB';

  it('parses a token and a date id, lower-casing the id', () => {
    expect(parseMoveInput({ manageToken: token, targetSessionId })).toEqual({
      kind: 'ok',
      input: {
        manageToken: token,
        targetSessionId: targetSessionId.toLowerCase(),
      },
    });
  });

  it.each([
    ['a short token', { manageToken: 'short', targetSessionId }],
    [
      'a date id that is not one',
      { manageToken: token, targetSessionId: 'nope' },
    ],
    ['an extra field', { manageToken: token, targetSessionId, extra: 1 }],
    ['nothing', undefined],
  ])('answers not found for %s', (_name, input) => {
    expect(parseMoveInput(input)).toEqual({
      kind: 'refused',
      result: { status: 'not_found' },
    });
  });

  it.each([
    [
      'strings',
      { manageToken: 'a', targetSessionId: 'b' },
      { manageToken: 'a', targetSessionId: 'b' },
    ],
    [
      'missing fields',
      { manageToken: null, targetSessionId: undefined },
      { manageToken: '', targetSessionId: '' },
    ],
    [
      'files',
      { manageToken: new Blob(), targetSessionId: 5 },
      { manageToken: '', targetSessionId: '' },
    ],
  ])('reads the form fields as %s', (_name, fields, expected) => {
    expect(moveInputFromForm(fields)).toEqual(expected);
  });

  it('takes a move job payload of ids only', () => {
    const payload = {
      orderId: '0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01',
      moveId: '1f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e02',
    };

    expect(GuestMovePayloadSchema.parse(payload)).toEqual(payload);
    expect(
      GuestMovePayloadSchema.safeParse({ ...payload, email: 'a@b.c' }).success,
    ).toBe(false);
    expect(
      GuestMovePayloadSchema.safeParse({ ...payload, moveId: 'nope' }).success,
    ).toBe(false);
  });
});

describe('moveChoices', () => {
  it('lists the dates the verdict accepts, in the order read, with their words', () => {
    const first = dateIn(72, {
      id: 'b0000000-0000-4000-8000-000000000001',
      spacesLeft: 8,
    });
    const full = dateIn(96, {
      id: 'b0000000-0000-4000-8000-000000000002',
      spacesLeft: 1,
    });
    const inside = dateIn(2, { id: 'b0000000-0000-4000-8000-000000000003' });
    const own = dateIn(120, { id: subject.sessionId });
    const last = dateIn(144, {
      id: 'b0000000-0000-4000-8000-000000000004',
      spacesLeft: 3,
    });

    expect(
      moveChoices({
        subject,
        candidates: [first, full, inside, own, last],
        now,
      }),
    ).toEqual([
      {
        sessionId: first.id,
        label: 'Sunday, November 8, 2026 · 7:00 AM EST',
        spacesLabel: '8 spaces',
      },
      {
        sessionId: last.id,
        label: 'Wednesday, November 11, 2026 · 7:00 AM EST',
        spacesLabel: '3 left',
      },
    ]);
  });

  it('lists nothing when no date is accepted', () => {
    expect(moveChoices({ subject, candidates: [], now })).toEqual([]);
  });
});
