import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  allocationNotice,
  opsSessionNotices,
  parseAllocationForm,
  parsePauseForm,
  pauseCancelTargets,
  pauseOutcomeHref,
  pausePlanFor,
  pauseView,
  sessionImpact,
  sessionNotice,
  shouldCancelTarget,
  tallyPauseResults,
  type PauseStep,
} from './opsSessions';
import { sessionAllocationChangedEntry } from './sessionAudit';
import {
  sessionId,
  userId,
  now,
  tomorrow,
  yesterday,
  order,
  form,
} from './opsSessions.fixtures';

// Behaviours under test, part B and C:
// - the pause form is read like the cancel form (id, fingerprint, the box); the capacity form like the host's
// - every capacity result names a notice, reusing the host session wording
// - the pause cancels future scheduled sessions with guests on them, and nothing else
// - an experience guests can see is paused, a paused one is finished, any other has nothing to pause
// - the pause section says what it cancels, is off while a booking blocks it, and on a paused experience cancels the rest
// - the pause sends the person back with the notice and the counts; the notice says how far it got only when the address carries both counts
// - the capacity change's audit row passes the audit log parser, and names the system when there is no user

describe('parsePauseForm', () => {
  const fields = { sessionId, fingerprint: '1:10800:0:2:1:0', confirm: 'on' };

  it('reads the id and the fingerprint, with the box ticked', () => {
    expect(parsePauseForm(form(fields))).toEqual({
      ok: true,
      value: { sessionId, fingerprint: '1:10800:0:2:1:0' },
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

  it('on a paused experience offers to cancel the rest, even with a blocked booking among them, and shows no panel with none left', () => {
    const blocked = sessionImpact([order({ attempts: [] })], [], now);
    expect(pauseView(input({ plan: 'finish', impact: blocked }))).toMatchObject(
      {
        buttonLabel: 'Cancel the remaining sessions',
        canPause: true,
      },
    );
    expect(pauseView(input({ plan: 'finish', targetCount: 0 }))).toBeNull();
  });

  it('is nothing for an experience with nothing to pause', () => {
    expect(pauseView(input({ plan: 'not_pausable' }))).toBeNull();
  });
});

describe('pauseOutcomeHref and sessionNotice', () => {
  const path = '/ops/sessions/x';

  it.each([
    [
      {
        status: 'paused',
        cancelled: 3,
        alreadyCancelled: 0,
        total: 3,
        left: 0,
      },
      `${path}?notice=paused&done=3&of=3`,
    ],
    [
      {
        status: 'paused',
        cancelled: 2,
        alreadyCancelled: 0,
        total: 3,
        left: 1,
      },
      `${path}?notice=paused_some_left&done=2&of=3`,
    ],
    [
      { status: 'incomplete', cancelled: 1, total: 3 },
      `${path}?notice=pause_incomplete&done=1&of=3`,
    ],
    [
      { status: 'incomplete', cancelled: 0, total: null },
      `${path}?notice=pause_incomplete`,
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

describe('tallyPauseResults and shouldCancelTarget', () => {
  const cancelled = {
    ordersRefunded: 1,
    ordersVoided: 0,
    holdsReleased: 0,
    attemptsLeft: 0,
  };
  const result = (r: object) => ({ kind: 'result', result: r }) as PauseStep;
  const steps: Record<string, PauseStep> = {
    cancelled: result({ status: 'cancelled', ...cancelled }),
    already: result({ status: 'already_cancelled', ...cancelled }),
    completed: result({ status: 'completed' }),
    gone: result({ status: 'not_found' }),
    skipped: { kind: 'skipped' },
  };

  it.each([
    ['cancelled', { cancelled: 1, alreadyCancelled: 0, left: 0 }],
    ['already', { cancelled: 0, alreadyCancelled: 1, left: 0 }],
    ['completed', { cancelled: 0, alreadyCancelled: 0, left: 1 }],
    ['gone', { cancelled: 0, alreadyCancelled: 0, left: 1 }],
    ['skipped', { cancelled: 0, alreadyCancelled: 0, left: 1 }],
  ])('counts a %s step in exactly one place', (kind, counts) => {
    expect(tallyPauseResults([steps[kind] as PauseStep])).toEqual({
      ...counts,
      total: 1,
    });
  });

  it('counts every step once, so the parts add up to the whole', () => {
    const all = Object.values(steps);
    const tally = tallyPauseResults([...all, ...all]);
    expect(tally).toEqual({
      cancelled: 2,
      alreadyCancelled: 2,
      left: 6,
      total: 10,
    });
    expect(tally.cancelled + tally.alreadyCancelled + tally.left).toBe(
      tally.total,
    );
  });

  it('is empty for no steps', () => {
    expect(tallyPauseResults([])).toEqual({
      cancelled: 0,
      alreadyCancelled: 0,
      left: 0,
      total: 0,
    });
  });

  it('skips a target whose bookings cannot be refunded in full, and cancels any other', () => {
    expect(shouldCancelTarget(sessionImpact([order()], [], now))).toBe(true);
    expect(
      shouldCancelTarget(sessionImpact([order({ attempts: [] })], [], now)),
    ).toBe(false);
  });
});

describe('the progress notice counts', () => {
  it('says how many were already cancelled', () => {
    expect(
      sessionNotice({
        notice: 'paused_some_left',
        done: '1',
        of: '4',
        already: '2',
      })?.title,
    ).toMatch(/^1 of 4 sessions cancelled, 2 already cancelled\. /);
  });

  it.each([
    ['more done than the whole', { done: '5', of: '3' }],
    [
      'done and already adding past the whole',
      { done: '2', of: '3', already: '2' },
    ],
    ['a count with a sign', { done: '-1', of: '3' }],
    ['a count with a decimal', { done: '1.5', of: '3' }],
    ['a count that is repeated', { done: ['1', '2'], of: '3' }],
  ])('falls back to the plain notice for %s', (_name, counts) => {
    expect(sessionNotice({ notice: 'pause_incomplete', ...counts })).toEqual(
      opsSessionNotices.pause_incomplete,
    );
  });

  it('clamps counts to the most a pause walks', () => {
    expect(
      sessionNotice({ notice: 'pause_incomplete', done: '99999', of: '99999' })
        ?.title,
    ).toMatch(/^5000 of 5000 sessions cancelled\. /);
  });
});
