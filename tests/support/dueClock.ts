import type { Clock } from '@/server/ports/clock';

/**
 * A clock a few seconds ahead, for draining jobs a test has just enqueued. A job's `run_after`
 * defaults to the database's clock, and the drain compares it with this one, so a database clock
 * that leads the test process would leave a fresh job not yet due. A retry's backoff is at least
 * 24 seconds, so the lead never makes one due.
 */
export const dueClock: Clock = {
  now: () => new Date(Date.now() + 5_000),
};
