import { createRandom } from '@/lib/seed/ids';

// Plans how a provider's events reach a webhook in tests: late, out of order, and more than
// once. It decides only the order and the lateness. Nothing here sleeps or sends, so a test
// stays fast and leaves no timer running.

/** Most extra deliveries of one event; real providers retry for days, tests need a handful. */
export const maxRepeats = 5;
/** Longest lateness, one day: the span in which a provider retries a failed delivery. */
export const maxDelayMs = 86_400_000;
export const maxEvents = 100;

export type DeliveryOptions = {
  /** The same seed always plans the same deliveries. A whole number from 0 to 4294967295. */
  seed: number;
  /** Extra deliveries of each event after its first, 0 to `maxRepeats`. Default 0. */
  repeats?: number;
  /** Each delivery arrives between 0 and this many milliseconds late, 0 to `maxDelayMs`. Default 0. */
  maxDelayMs?: number;
};

export type PlannedDelivery<E> = {
  event: E;
  /** 0 for the first delivery of this event, 1 for its first repeat, and so on. */
  attempt: number;
  /** Milliseconds after the events were emitted that this delivery arrives. */
  delayMs: number;
  /** The event's place in the list passed in, which is the order it was emitted. */
  sentIndex: number;
};

function requireWhole(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(
      `${name} is a whole number from 0 to ${String(max)}, got ${String(value)}`,
    );
  }
}

/**
 * Every event once, plus `repeats` more times each, all within `maxDelayMs`. A repeat is never
 * earlier than the delivery it repeats. The result is in arrival order: with a delay above zero the events usually arrive
 * out of the order they were sent, and with none they arrive as sent, each followed by its
 * repeats. To force a particular order, pass the events already in the order to be sent.
 */
export function planDeliveries<E>(
  events: readonly E[],
  options: DeliveryOptions,
): PlannedDelivery<E>[] {
  const repeats = options.repeats ?? 0;
  const lateness = options.maxDelayMs ?? 0;
  requireWhole('repeats', repeats, maxRepeats);
  requireWhole('maxDelayMs', lateness, maxDelayMs);
  if (events.length > maxEvents) {
    throw new RangeError(
      `At most ${String(maxEvents)} events can be planned, got ${String(events.length)}`,
    );
  }
  const random = createRandom(options.seed);
  const planned: PlannedDelivery<E>[] = [];
  events.forEach((event, sentIndex) => {
    const delays = Array.from({ length: repeats + 1 }, () =>
      random.int(0, lateness),
    ).sort((a, b) => a - b);
    delays.forEach((delayMs, attempt) => {
      planned.push({ event, attempt, delayMs, sentIndex });
    });
  });
  return planned.sort(
    (a, b) =>
      a.delayMs - b.delayMs ||
      a.sentIndex - b.sentIndex ||
      a.attempt - b.attempt,
  );
}
