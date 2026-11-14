import 'server-only';
import { chooseClock, type ClockChoice } from '@/lib/jobs';
import { env } from '@/server/env';
import { systemClock } from '@/server/ports/clock';

/**
 * Whether a manual time may be used on this deployment, and which. Both the pulse route's `asOf`
 * and the test console's clock go through here, so the `DEMO_CLOCK` switch and the 400-day window
 * are decided once.
 */
export function chooseDemoClock(asOf: Date | undefined): ClockChoice {
  return chooseClock({
    asOf,
    demoClock: env.DEMO_CLOCK,
    realNow: systemClock.now(),
  });
}
