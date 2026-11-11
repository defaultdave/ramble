import 'server-only';
import { lockRetryLimit, type LockedAttempt } from '@/lib/orderLocks';

/**
 * Runs `attempt` (a transaction of its own that returns `stale` after writing nothing when the
 * locks it took did not cover the order) until it is done, at most `lockRetryLimit` times. An order
 * that keeps moving past that is a bug, so it throws instead of answering.
 */
export async function untilLocksCoverOrder<T>(
  attempt: () => Promise<LockedAttempt<T>>,
): Promise<T> {
  for (let tries = 0; tries < lockRetryLimit; tries += 1) {
    const outcome = await attempt();
    if (outcome.kind === 'done') return outcome.value;
  }
  throw new Error('The order kept moving while its locks were taken');
}
