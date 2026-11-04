import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  allRows,
  client,
  insertRaw,
  onlyRow,
  setupJobsDatabase,
} from './jobsFixtures';

vi.mock('@/server/monitoring/alerts', async () => ({
  alerts: { raise: (await import('./jobsFixtures')).raise },
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - the database accepts a well-formed job and refuses each bad row: kind shape and length, payload type and size,
//   dedupe key shape and reuse, max attempts range, attempts range, last-error length, finished_at and locked_until
//   out of step with status, and a run_after outside the readable years

setupJobsDatabase();

describe('jobs constraints', () => {
  it('accepts a well-formed row', async () => {
    await insertRaw({ kind: 'send-email', dedupeKey: 'order:1/mail_2.x' });

    expect((await onlyRow()).status).toBe('pending');
  });

  it.each([
    ['an upper-case kind', { kind: 'Send' }, 'jobs_kind_shape'],
    ['a double hyphen', { kind: 'a--b' }, 'jobs_kind_shape'],
    ['a leading hyphen', { kind: '-a' }, 'jobs_kind_shape'],
    ['an empty kind', { kind: '' }, 'jobs_kind_shape'],
    ['a trailing newline', { kind: 'a\n' }, 'jobs_kind_shape'],
    ['a kind of 65 characters', { kind: 'a'.repeat(65) }, 'jobs_kind_shape'],
    ['an array payload', { payload: '[]' }, 'jobs_payload_bounded'],
    ['a string payload', { payload: '"x"' }, 'jobs_payload_bounded'],
    [
      'a payload over 16 KB',
      { payload: JSON.stringify({ text: 'x'.repeat(20_000) }) },
      'jobs_payload_bounded',
    ],
    [
      'a dedupe key with a space',
      { dedupeKey: 'a b' },
      'jobs_dedupe_key_shape',
    ],
    ['an empty dedupe key', { dedupeKey: '' }, 'jobs_dedupe_key_shape'],
    [
      'a dedupe key of 201 characters',
      { dedupeKey: 'k'.repeat(201) },
      'jobs_dedupe_key_shape',
    ],
    ['zero max attempts', { maxAttempts: 0 }, 'jobs_max_attempts_range'],
    ['21 max attempts', { maxAttempts: 21 }, 'jobs_max_attempts_range'],
    [
      'attempts past max attempts',
      { attempts: 4, maxAttempts: 3 },
      'jobs_attempts_range',
    ],
    ['negative attempts', { attempts: -1 }, 'jobs_attempts_range'],
    [
      'a last error of 2001 characters',
      { lastError: 'e'.repeat(2001) },
      'jobs_last_error_bounded',
    ],
    [
      'a succeeded job with no finish time',
      { status: 'succeeded' },
      'jobs_finished_matches_status',
    ],
    [
      'a dead job with no finish time',
      { status: 'dead' },
      'jobs_finished_matches_status',
    ],
    [
      'a pending job with a finish time',
      { finishedAt: '2026-01-01T00:00:00Z' },
      'jobs_finished_matches_status',
    ],
    [
      'a running job with no lock',
      { status: 'running', attempts: 1 },
      'jobs_locked_matches_status',
    ],
    [
      'a pending job with a lock',
      { lockedUntil: '2026-01-01T00:00:00Z' },
      'jobs_locked_matches_status',
    ],
    [
      'a run time before year 1000',
      { runAfter: '0500-01-01T00:00:00Z' },
      'jobs_run_after_readable',
    ],
    [
      'a run time in year 10000',
      { runAfter: '10000-01-01T00:00:00Z' },
      'jobs_run_after_readable',
    ],
  ])('refuses %s', async (_name, row, constraint) => {
    await expect(insertRaw(row)).rejects.toMatchObject({
      cause: { constraint },
    });
  });

  it('accepts a payload and last error exactly at their limits', async () => {
    await insertRaw({
      payload: JSON.stringify({ text: 'x'.repeat(16_000) }),
      lastError: 'e'.repeat(2000),
    });

    expect(await allRows()).toHaveLength(1);
  });

  it('refuses a second row with the same dedupe key, and allows many with none', async () => {
    await insertRaw({ dedupeKey: 'same' });
    await insertRaw();
    await insertRaw();

    await expect(insertRaw({ dedupeKey: 'same' })).rejects.toMatchObject({
      cause: { constraint: 'jobs_dedupe_key_unique' },
    });
  });

  it('refuses a null kind and a null payload', async () => {
    await insertRaw();
    await expect(
      client.db.execute(sql`UPDATE jobs SET kind = NULL`),
    ).rejects.toMatchObject({ cause: { code: '23502' } });
    await expect(
      client.db.execute(sql`UPDATE jobs SET payload = NULL`),
    ).rejects.toMatchObject({ cause: { code: '23502' } });
  });
});
