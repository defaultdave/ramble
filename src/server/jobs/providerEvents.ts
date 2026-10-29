import 'server-only';
import {
  ProcessProviderEventPayloadSchema,
  eventAlertKey,
  providerEventAlerts,
} from '@/lib/providerEvents';
import { confirmOrder } from '@/server/db/confirmOrder';
import {
  processProviderEvent,
  type EventMetadata,
} from '@/server/db/providerEvents';
import { alerts } from '@/server/monitoring/alerts';
import { getPaymentsPort } from '@/server/ports/payments/gateway';
import type { JobDefinition } from './registry';

type Context = Parameters<
  JobDefinition<typeof ProcessProviderEventPayloadSchema>['handleIdempotent']
>[0];

const defaultDependencies = {
  confirmOrder,
  async lookupMetadata(event: {
    provider: string;
    objectId: string;
  }): Promise<EventMetadata | null> {
    const port = getPaymentsPort();
    if (port.provider !== event.provider) {
      throw new Error('No payments adapter for this provider');
    }
    const payment = await port.retrieve({
      kind: 'payment',
      id: event.objectId,
    });
    return payment?.metadata ?? null;
  },
};

/**
 * Handles one stored provider event (design doc 4.2.3, "What each event does"). Safe to run twice:
 * an event already processed returns at once, and a retry of an unmatched event is a new job.
 * Alerts carry ids, never the event body.
 */
export async function handleProviderEvent(
  { tx, payload }: Context,
  dependencies = defaultDependencies,
): Promise<void> {
  const result = await processProviderEvent(tx, {
    eventId: payload.eventId,
    ...dependencies,
  });
  if (result.status === 'left' && result.reason === 'duplicate_payment') {
    alerts.raise(
      providerEventAlerts.duplicatePayment,
      'error',
      eventAlertKey(payload.eventId),
      { eventId: payload.eventId, orderId: result.orderId },
    );
  }
  if (result.status === 'unmatched' && result.alert !== null) {
    const key = eventAlertKey(payload.eventId);
    alerts.raise(
      providerEventAlerts.unmatched,
      'error',
      result.alert === 'gave_up' ? `${key}:gave-up` : key,
      { eventId: payload.eventId, tries: result.tries },
    );
  }
}
