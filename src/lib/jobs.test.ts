import { describe, expect, it } from 'vitest';
import { prepareAlert } from './alerts';
import {
  EnqueueInputSchema,
  abandonedMessage,
  backoffSeconds,
  bearerToken,
  chooseClock,
  claimDecision,
  deadJobAlertKey,
  describeJobError,
  drainMayContinue,
  failureOutcome,
  jobLimits,
  lockExpiry,
  nextClaimSize,
  ownsClaim,
  parsePulseBody,
  payloadFits,
  purgeMayContinue,
} from './jobs';

// Behaviours under test, one per decision, branch, or risk:
// - an enqueue input needs a kebab kind within 64 characters, a dedupe key of safe characters within 200, and a readable runAfter
// - a payload fits at exactly 16 KB and not one byte over; the size counts bytes, not characters
// - backoff doubles from 30 seconds, never passes 6 hours, never rises as jitter is added, and is the same for the same job
// - a pending row is due at runAfter and not before; a running row only once its lock has lapsed; settled rows never
// - a due row with no attempts left is abandoned, not claimed
// - a claim is still ours only when status, attempts, and lock all match
// - a failure retries with backoff until the last attempt, then dead-letters; the stored error is redacted and bounded
// - the drain stops at 200 jobs or 60 seconds, and the last claim is cut to the jobs left
// - the purge goes on only after a full batch and within the time budget
// - the dead-job alert key is a valid alert dedupe key whatever the kind length
// - a bearer header is read only in the exact form; the pulse body is empty or exactly { asOf }
// - a manual time needs DEMO_CLOCK on and must be within 400 days of now, either side

const now = new Date('2026-11-01T12:00:00.000Z');
const jobId = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

describe('EnqueueInputSchema', () => {
  const parse = (value: object) => EnqueueInputSchema.safeParse(value).success;

  it.each([
    ['a plain kind', { kind: 'send-email' }, true],
    ['a single word', { kind: 'noop' }, true],
    ['a kind at 64 characters', { kind: 'a'.repeat(64) }, true],
    ['a kind at 65 characters', { kind: 'a'.repeat(65) }, false],
    ['an upper-case kind', { kind: 'Send-Email' }, false],
    ['a double hyphen', { kind: 'send--email' }, false],
    ['a trailing hyphen', { kind: 'send-' }, false],
    ['an empty kind', { kind: '' }, false],
    [
      'a dedupe key of safe characters',
      { kind: 'a', dedupeKey: 'order:1/x_y.z-9' },
      true,
    ],
    ['a dedupe key at 200', { kind: 'a', dedupeKey: 'k'.repeat(200) }, true],
    ['a dedupe key at 201', { kind: 'a', dedupeKey: 'k'.repeat(201) }, false],
    ['an empty dedupe key', { kind: 'a', dedupeKey: '' }, false],
    ['a dedupe key with a space', { kind: 'a', dedupeKey: 'a b' }, false],
    [
      'a dedupe key starting with a colon',
      { kind: 'a', dedupeKey: ':a' },
      false,
    ],
    ['a runAfter date', { kind: 'a', runAfter: now }, true],
    [
      'an invalid runAfter date',
      { kind: 'a', runAfter: new Date('nope') },
      false,
    ],
    [
      'a runAfter before year 1000',
      { kind: 'a', runAfter: new Date('0500-01-01') },
      false,
    ],
    [
      'a runAfter in year 10000',
      { kind: 'a', runAfter: new Date('+010000-01-01') },
      false,
    ],
  ])('%s', (_name, value, accepted) => {
    expect(parse(value)).toBe(accepted);
  });
});

describe('payloadFits', () => {
  // {"text":""} is 11 bytes before any content.
  const ofBytes = (bytes: number) => ({ text: 'x'.repeat(bytes - 11) });

  it('accepts a payload of exactly 16 KB', () => {
    const payload = ofBytes(jobLimits.payloadMaxBytes);
    expect(JSON.stringify(payload)).toHaveLength(jobLimits.payloadMaxBytes);
    expect(payloadFits(payload)).toBe(true);
  });

  it('refuses a payload one byte over', () => {
    expect(payloadFits(ofBytes(jobLimits.payloadMaxBytes + 1))).toBe(false);
  });

  it('counts bytes, not characters', () => {
    expect(
      payloadFits({ text: 'é'.repeat(jobLimits.payloadMaxBytes / 2) }),
    ).toBe(false);
  });
});

describe('backoffSeconds', () => {
  it.each([
    [1, 30],
    [2, 60],
    [3, 120],
    [4, 240],
  ])(
    'attempt %i waits between 80 and 100 percent of %i seconds',
    (attempts, nominal) => {
      const seconds = backoffSeconds(attempts, jobId);
      expect(seconds).toBeGreaterThanOrEqual(Math.round(nominal * 0.8));
      expect(seconds).toBeLessThanOrEqual(nominal);
    },
  );

  it('never passes the 6-hour cap, however many attempts', () => {
    for (const attempts of [9, 10, 20, 1000]) {
      expect(backoffSeconds(attempts, jobId)).toBeLessThanOrEqual(
        jobLimits.backoffCapSeconds,
      );
    }
    expect(backoffSeconds(20, jobId)).toBeGreaterThanOrEqual(
      jobLimits.backoffCapSeconds * 0.8 - 1,
    );
  });

  it('is the same for the same job and varies across jobs', () => {
    const ids = Array.from(
      { length: 20 },
      (_, index) => `job-${String(index)}`,
    );
    const delays = ids.map((id) => backoffSeconds(3, id));

    expect(delays).toEqual(ids.map((id) => backoffSeconds(3, id)));
    expect(new Set(delays).size).toBeGreaterThan(5);
  });

  it('treats a count below one as the first attempt', () => {
    expect(backoffSeconds(0, jobId)).toBe(backoffSeconds(1, jobId));
  });
});

describe('claimDecision', () => {
  const later = new Date(now.getTime() + 1000);
  const earlier = new Date(now.getTime() - 1000);
  const row = {
    status: 'pending' as const,
    runAfter: earlier,
    lockedUntil: null,
    attempts: 0,
    maxAttempts: 3,
  };

  it.each([
    ['a pending row past runAfter', row, 'claim'],
    ['a pending row exactly at runAfter', { ...row, runAfter: now }, 'claim'],
    ['a pending row before runAfter', { ...row, runAfter: later }, 'skip'],
    [
      'a running row with a live lock',
      { ...row, status: 'running' as const, lockedUntil: later },
      'skip',
    ],
    [
      'a running row whose lock lapsed',
      { ...row, status: 'running' as const, lockedUntil: earlier, attempts: 1 },
      'claim',
    ],
    [
      'a running row locked exactly now',
      { ...row, status: 'running' as const, lockedUntil: now, attempts: 1 },
      'claim',
    ],
    [
      'a running row with no lock time',
      { ...row, status: 'running' as const },
      'skip',
    ],
    ['a succeeded row', { ...row, status: 'succeeded' as const }, 'skip'],
    ['a dead row', { ...row, status: 'dead' as const }, 'skip'],
    [
      'a lapsed row on its last attempt',
      { ...row, status: 'running' as const, lockedUntil: earlier, attempts: 3 },
      'abandon',
    ],
    ['a pending row with no attempts left', { ...row, attempts: 3 }, 'abandon'],
    [
      'a pending row on its last attempt but one',
      { ...row, attempts: 2 },
      'claim',
    ],
  ])('%s', (_name, input, decision) => {
    expect(claimDecision(input, now)).toBe(decision);
  });
});

describe('lockExpiry', () => {
  it('is five minutes after now', () => {
    expect(lockExpiry(now)).toEqual(new Date('2026-11-01T12:05:00.000Z'));
  });
});

describe('ownsClaim', () => {
  const claim = {
    attempts: 2,
    lockedUntil: new Date('2026-11-01T12:05:00.000Z'),
  };
  const row = {
    status: 'running' as const,
    attempts: 2,
    lockedUntil: new Date(claim.lockedUntil),
  };

  it.each([
    ['the same claim', row, true],
    ['a finished job', { ...row, status: 'succeeded' as const }, false],
    ['a reclaimed job (more attempts)', { ...row, attempts: 3 }, false],
    [
      'a reclaimed job (new lock)',
      { ...row, lockedUntil: new Date('2026-11-01T12:10:00.000Z') },
      false,
    ],
    ['a job with no lock', { ...row, lockedUntil: null }, false],
  ])('%s', (_name, input, owned) => {
    expect(ownsClaim(input, claim)).toBe(owned);
  });
});

describe('failureOutcome', () => {
  const base = { maxAttempts: 3, jobId, now, error: new Error('boom') };

  it('retries after a backoff while attempts remain', () => {
    const outcome = failureOutcome({ ...base, attempts: 1 });

    expect(outcome.status).toBe('pending');
    if (outcome.status !== 'pending') return;
    expect(outcome.runAfter).toEqual(
      new Date(now.getTime() + backoffSeconds(1, jobId) * 1000),
    );
    expect(outcome.lastError).toBe('Error: boom');
  });

  it('dead-letters on the last attempt', () => {
    expect(failureOutcome({ ...base, attempts: 3 }).status).toBe('dead');
  });

  it('describes a thrown non-error without its value', () => {
    expect(describeJobError('secret-looking string')).toBe(
      'NonError: thrown value',
    );
  });

  it('redacts and bounds a long or sensitive message', () => {
    const text = describeJobError(
      new Error(`mail to guest@example.com ${'x'.repeat(5000)}`),
    );

    expect(text).not.toContain('guest@example.com');
    expect(text.length).toBeLessThanOrEqual(jobLimits.lastErrorMaxChars);
  });

  it('keeps the abandoned message within the column limit', () => {
    expect(abandonedMessage.length).toBeLessThanOrEqual(
      jobLimits.lastErrorMaxChars,
    );
  });
});

describe('drainMayContinue and nextClaimSize', () => {
  it.each([
    [{ claimed: 0, elapsedMs: 0 }, true],
    [{ claimed: 199, elapsedMs: 59_999 }, true],
    [{ claimed: 200, elapsedMs: 0 }, false],
    [{ claimed: 0, elapsedMs: 60_000 }, false],
  ])('%j continues: %s', (progress, expected) => {
    expect(drainMayContinue(progress)).toBe(expected);
  });

  it.each([
    [0, 25],
    [175, 25],
    [190, 10],
    [199, 1],
  ])('after %i claimed the next claim takes %i', (claimed, size) => {
    expect(nextClaimSize(claimed)).toBe(size);
  });
});

describe('purgeMayContinue', () => {
  it.each([
    [{ purged: 1000, batchSize: 1000, elapsedMs: 0 }, true],
    [{ purged: 999, batchSize: 1000, elapsedMs: 0 }, false],
    [{ purged: 0, batchSize: 1000, elapsedMs: 0 }, false],
    [{ purged: 1000, batchSize: 1000, elapsedMs: 60_000 }, false],
  ])('%j continues: %s', (input, expected) => {
    expect(purgeMayContinue(input)).toBe(expected);
  });
});

describe('deadJobAlertKey', () => {
  it.each(['noop', 'a'.repeat(64)])(
    'is a key the alert system accepts for kind %s',
    (kind) => {
      const key = deadJobAlertKey(kind, jobId);

      expect(key.length).toBeLessThanOrEqual(100);
      expect(() =>
        prepareAlert({ kind: 'job-dead', severity: 'error', dedupeKey: key }),
      ).not.toThrow();
    },
  );

  it('names the kind and the job', () => {
    expect(deadJobAlertKey('send-email', jobId)).toBe(`send-email:${jobId}`);
  });
});

describe('bearerToken', () => {
  it.each([
    ['Bearer abc123', 'abc123'],
    ['bearer abc123', 'abc123'],
    ['Bearer  abc', null],
    ['Basic abc123', null],
    ['Bearer', null],
    ['Bearer a b', null],
    [`Bearer ${'a'.repeat(257)}`, null],
    ['', null],
    [null, null],
  ])('%j reads as %j', (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });
});

describe('parsePulseBody', () => {
  it.each(['', '   ', '\n'])('reads %j as a plain pulse', (text) => {
    expect(parsePulseBody(text)).toEqual({ ok: true, asOf: undefined });
  });

  it('reads an empty object as a plain pulse', () => {
    expect(parsePulseBody('{}')).toEqual({ ok: true, asOf: undefined });
  });

  it('reads asOf as a date', () => {
    expect(parsePulseBody('{"asOf":"2026-11-02T09:30:00Z"}')).toEqual({
      ok: true,
      asOf: new Date('2026-11-02T09:30:00Z'),
    });
  });

  it.each([
    ['not JSON', 'asOf=1'],
    ['an array', '[]'],
    ['null', 'null'],
    ['an extra field', '{"asOf":"2026-11-02T09:30:00Z","x":1}'],
    ['a date with no time', '{"asOf":"2026-11-02"}'],
    ['a date-time with no offset', '{"asOf":"2026-11-02T09:30:00"}'],
    ['a number', '{"asOf":1793000000}'],
    ['an over-long value', `{"asOf":"${'9'.repeat(100)}"}`],
  ])('refuses %s', (_name, text) => {
    expect(parsePulseBody(text)).toEqual({ ok: false });
  });
});

describe('chooseClock', () => {
  const day = 24 * 60 * 60 * 1000;
  const choose = (asOf: Date | undefined, demoClock: 'on' | 'off') =>
    chooseClock({ asOf, demoClock, realNow: now });

  it('uses the real clock when there is no asOf, whatever DEMO_CLOCK says', () => {
    expect(choose(undefined, 'off')).toEqual({ ok: true, asOf: undefined });
    expect(choose(undefined, 'on')).toEqual({ ok: true, asOf: undefined });
  });

  it('refuses a manual time while DEMO_CLOCK is off', () => {
    expect(choose(new Date(now.getTime() + day), 'off')).toEqual({
      ok: false,
      reason: 'demo-clock-off',
    });
  });

  it.each([
    ['tomorrow', day, true],
    ['now', 0, true],
    ['400 days ahead', 400 * day, true],
    ['400 days back', -400 * day, true],
    ['one second past 400 days ahead', 400 * day + 1000, false],
    ['one second past 400 days back', -400 * day - 1000, false],
  ])('%s with DEMO_CLOCK on', (_name, offset, accepted) => {
    const at = new Date(now.getTime() + offset);

    expect(choose(at, 'on')).toEqual(
      accepted ? { ok: true, asOf: at } : { ok: false, reason: 'out-of-range' },
    );
  });

  it('refuses an invalid date', () => {
    expect(choose(new Date('nope'), 'on')).toEqual({
      ok: false,
      reason: 'out-of-range',
    });
  });
});
