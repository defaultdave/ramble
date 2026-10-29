import {
  planDeliveries,
  type DeliveryOptions,
  type PlannedDelivery,
} from '@/lib/eventDelivery';
import type { ProviderEvent, WebhookDelivery } from '@/server/ports/payments';

/** One webhook request the simulator makes. */
export type SimulatedDelivery = PlannedDelivery<ProviderEvent> & {
  /** The signed request the provider would send at `at`. */
  delivery: WebhookDelivery;
  /** When it arrives: `startedAt` plus the delay. A test with a fake clock moves it here first. */
  at: Date;
};

type SimulatorGateway = {
  /** Every event emitted so far, oldest first. */
  emittedEvents(): ProviderEvent[];
  /** Signs an event as sent at `signedAt`, so a late delivery carries a fresh signature. */
  signWebhook(event: ProviderEvent, signedAt?: Date): WebhookDelivery;
};

/**
 * Plays the events the fake gateway has emitted into `handle`, late, out of order, and
 * repeated as `options` say, for tests of webhook intake and order confirmation. Deliveries
 * run one at a time in arrival order; nothing waits on a real timer and nothing is sent over
 * a network. The same seed gives the same sequence.
 */
export async function deliverEmittedEvents(
  gateway: SimulatorGateway,
  options: DeliveryOptions,
  startedAt: Date,
  handle: (delivery: SimulatedDelivery) => Promise<void> | void,
): Promise<SimulatedDelivery[]> {
  const plan = planDeliveries(gateway.emittedEvents(), options);
  const played: SimulatedDelivery[] = [];
  for (const step of plan) {
    const at = new Date(startedAt.getTime() + step.delayMs);
    const simulated = {
      ...step,
      at,
      delivery: gateway.signWebhook(step.event, at),
    };
    await handle(simulated);
    played.push(simulated);
  }
  return played;
}
