import 'server-only';
import {
  ProcessProviderEventPayloadSchema,
  alertFor,
  isProviderMismatch,
  parsePreparedMetadata,
  type EventMetadata,
} from '@/lib/providerEvents';
import { confirmOrder } from '@/server/db/confirmOrder';
import {
  processProviderEvent,
  readEventToLookUp,
} from '@/server/db/providerEvents';
import { alerts } from '@/server/monitoring/alerts';
import { getPaymentsPort } from '@/server/ports/payments/gateway';
import type { JobDefinition } from './registry';

type Context = Parameters<
  JobDefinition<typeof ProcessProviderEventPayloadSchema>['handleIdempotent']
>[0];

/**
 * Before the job's transaction opens: asks the provider for the Ramble ids of a payment whose event
 * carried none (design doc 4.2.3 rule 7), so no connection is held during the call. Null when the
 * event needs no lookup or the provider does not know the payment.
 */
export async function prepareProviderEvent(payload: {
  eventId: string;
}): Promise<EventMetadata | null> {
  const event = await readEventToLookUp(payload.eventId);
  if (!event) return null;
  const port = getPaymentsPort();
  if (isProviderMismatch(port.provider, event.provider)) {
    throw new Error('No payments adapter for this provider');
  }
  const payment = await port.retrieve({ kind: 'payment', id: event.objectId });
  return parsePreparedMetadata(payment?.metadata);
}

/**
 * Handles one stored provider event (design doc 4.2.3, "What each event does"). Safe to run twice:
 * an event already processed returns at once, and a retry is a new job. Alerts carry ids, never the
 * event body.
 */
export async function handleProviderEvent(
  { tx, payload, prepared }: Context,
  dependencies = { confirmOrder },
): Promise<void> {
  const result = await processProviderEvent(tx, {
    eventId: payload.eventId,
    metadata: parsePreparedMetadata(prepared),
    ...dependencies,
  });
  const alert = alertFor(result, payload.eventId);
  if (alert) alerts.raise(alert.kind, 'error', alert.key, alert.context);
}
