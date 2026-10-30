import 'server-only';
import type { Clock } from './index';

/** A clock that always says `at`. The manual pulse trigger uses it; tests do too. */
export function fixedClock(at: Date): Clock {
  const instant = at.getTime();
  return { now: () => new Date(instant) };
}
