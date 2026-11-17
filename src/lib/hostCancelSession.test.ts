import { describe, expect, it } from 'vitest';
import {
  buildHostCancelView,
  hostCancelNotice,
  hostCancelOutcomeCode,
  hostCancelCheck,
  hostCancelState,
  parseHostCancelForm,
  type HostCancelData,
} from './hostCancelSession';
import { hostCancelCopy, hostCancelNotices } from './copy/hostSessions';
import { impactView, sessionImpact } from './opsSessions';
import {
  form,
  now,
  order,
  sessionId,
  tomorrow,
  yesterday,
} from './opsSessions.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the page offers the form only for a scheduled session that has not started and whose bookings can all be refunded;
//   a cancelled, completed, started or blocked session says why instead, and a cancelled one wins over the rest
// - the view names the session, its seats and status, and words the impact as ops does: bookings refunded and the amount, unpaid orders voided, holds released
// - a blocked booking is named in the view and stops the form
// - the form is read only when it carries a session id, the impact that was shown and the ticked box; nothing is repaired
// - the cancel check refuses a started session, then a blocked booking, then a changed impact, and lets a cancelled session through with any fingerprint
// - each result of an attempt names one notice, and an unknown or repeated notice in the address shows none

const session = (over: Partial<HostCancelData['session']> = {}) => ({
  id: sessionId,
  experienceName: 'Sunset kayak',
  startsAt: tomorrow,
  timeZone: 'America/New_York',
  allocation: 10,
  seatsSold: 2,
  status: 'scheduled' as const,
  ...over,
});

const data = (
  over: Partial<HostCancelData['session']> = {},
  orders = [order()],
): HostCancelData => ({
  session: session(over),
  impact: sessionImpact(orders, [], now),
  at: now,
});

describe('hostCancelState', () => {
  it.each([
    ['a scheduled session that has not started', data(), 'ready'],
    ['a session with no booking', data({}, []), 'ready'],
    [
      'a cancelled session, even one that has started',
      data({ status: 'cancelled', startsAt: yesterday }),
      'cancelled',
    ],
    ['a completed session', data({ status: 'completed' }), 'completed'],
    ['a session that has started', data({ startsAt: yesterday }), 'started'],
    [
      'a booking with no payment to send the money back to',
      data({}, [order({ attempts: [] })]),
      'blocked',
    ],
    [
      'a booking paid in part by a gift',
      data({}, [order({ amountDueMinor: 5000 })]),
      'blocked',
    ],
  ] as const)('is for %s', (_label, input, state) => {
    expect(hostCancelState(input)).toBe(state);
  });

  it('reads a session starting right now as started', () => {
    expect(hostCancelState(data({ startsAt: now }))).toBe('started');
  });
});

describe('hostCancelCheck', () => {
  const current = sessionImpact([order()], [], now);
  const fresh = impactView(current).fingerprint;
  const old = '9:9:9:9:9:9';
  const blocked = sessionImpact([order({ attempts: [] })], [], now);

  it.each([
    [
      'a started session, whatever else',
      'scheduled',
      'ended',
      current,
      old,
      'ended',
    ],
    [
      'a started session that is blocked',
      'scheduled',
      'ended',
      blocked,
      fresh,
      'ended',
    ],
    [
      'a blocked booking',
      'scheduled',
      'ok',
      blocked,
      impactView(blocked).fingerprint,
      'blocked',
    ],
    ['a changed impact', 'scheduled', 'ok', current, old, 'stale'],
    ['the impact as it was read', 'scheduled', 'ok', current, fresh, 'proceed'],
    [
      'a cancelled session with an old fingerprint',
      'cancelled',
      'ok',
      current,
      old,
      'proceed',
    ],
    [
      'a cancelled session with the current fingerprint',
      'cancelled',
      'ok',
      current,
      fresh,
      'proceed',
    ],
    [
      'a blocked booking on a cancelled session',
      'cancelled',
      'ok',
      blocked,
      old,
      'blocked',
    ],
  ] as const)(
    'is for %s',
    (_label, status, gate, impact, fingerprint, check) => {
      expect(hostCancelCheck({ status, gate, impact, fingerprint })).toBe(
        check,
      );
    },
  );
});

describe('buildHostCancelView', () => {
  it('names the session and words who it affects, with no stand-in text when the form shows', () => {
    const view = buildHostCancelView(data());
    expect(view).toMatchObject({
      id: sessionId,
      experienceName: 'Sunset kayak',
      seatsLabel: '2 of 10 seats sold',
      statusLabel: 'Scheduled',
      state: 'ready',
      stateText: null,
    });
    expect(view.title).toContain('Sunset kayak, ');
    expect(view.impact.summary).toBe(
      '1 booking refunded in full, $108.00 in all; 0 unpaid orders voided; 0 holds released.',
    );
    expect(view.impact.bookings).toEqual([
      { reference: 'RMB-0001', amountLabel: '$108.00' },
    ]);
  });

  it.each(['blocked', 'started', 'completed', 'cancelled'] as const)(
    'says why there is no form for a %s session',
    (state) => {
      const input = {
        blocked: data({}, [order({ attempts: [] })]),
        started: data({ startsAt: yesterday }),
        completed: data({ status: 'completed' }),
        cancelled: data({ status: 'cancelled' }),
      }[state];
      expect(buildHostCancelView(input)).toMatchObject({
        state,
        stateText: hostCancelCopy.states[state],
      });
    },
  );

  it('names the booking that cannot be refunded in full', () => {
    const view = buildHostCancelView(
      data({}, [order({ reference: 'RMB-0009', attempts: [] })]),
    );
    expect(view.impact.blockedText).toContain('RMB-0009');
  });
});

describe('parseHostCancelForm', () => {
  const fingerprint = '1:10800:0:0:0:0';
  const fields = { sessionId, fingerprint, confirm: 'on' };

  it('reads the session, the impact shown and the ticked box', () => {
    expect(parseHostCancelForm(form(fields))).toEqual({
      ok: true,
      value: { sessionId, fingerprint },
    });
  });

  it.each([
    ['the box is not ticked', { confirm: undefined }],
    ['the session is not an id', { sessionId: 'not-an-id' }],
    ['there is no session', { sessionId: undefined }],
    ['the impact is not a fingerprint', { fingerprint: '1:2' }],
    ['there is no impact', { fingerprint: undefined }],
  ])('refuses the form when %s', (_label, over) => {
    expect(parseHostCancelForm(form({ ...fields, ...over }))).toEqual({
      ok: false,
    });
  });
});

describe('hostCancelOutcomeCode', () => {
  it.each([
    [{ kind: 'blocked' }, 'blocked'],
    [{ kind: 'stale' }, 'stale'],
    [{ kind: 'ended' }, 'in_the_past'],
    [{ kind: 'done', result: { status: 'not_found' } }, 'not_found'],
    [{ kind: 'done', result: { status: 'completed' } }, 'completed'],
    [
      {
        kind: 'done',
        result: {
          status: 'cancelled',
          ordersRefunded: 1,
          ordersVoided: 0,
          holdsReleased: 0,
          attemptsLeft: 0,
        },
      },
      'cancelled',
    ],
    [
      {
        kind: 'done',
        result: {
          status: 'cancelled',
          ordersRefunded: 1,
          ordersVoided: 0,
          holdsReleased: 0,
          attemptsLeft: 1,
        },
      },
      'cancelled_payments_left',
    ],
    [
      {
        kind: 'done',
        result: {
          status: 'already_cancelled',
          ordersRefunded: 0,
          ordersVoided: 0,
          holdsReleased: 0,
          attemptsLeft: 0,
        },
      },
      'already_cancelled',
    ],
    ['invalid', 'invalid'],
  ] as const)('names %j as %s', (outcome, code) => {
    expect(hostCancelOutcomeCode(outcome)).toBe(code);
  });
});

describe('hostCancelNotice', () => {
  it.each(Object.keys(hostCancelNotices))('shows the %s notice', (code) => {
    expect(hostCancelNotice(code)).toEqual(
      hostCancelNotices[code as keyof typeof hostCancelNotices],
    );
  });

  it.each([undefined, 'nope', ['cancelled', 'stale']])(
    'shows nothing for %j',
    (raw) => {
      expect(hostCancelNotice(raw)).toBeNull();
    },
  );
});
