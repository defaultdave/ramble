import 'server-only';
import { z } from 'zod';
import {
  handsOverProviderEvents,
  type ProcessRefundPayloadSchema,
} from '@/lib/refunds';
import { providerEventRow } from '@/lib/providerEvents';
import { readRefundToSend, recordProviderRefundId } from '@/server/db/refunds';
import { recordProviderEvent } from '@/server/db/providerEvents';
import {
  getFakePayments,
  getPaymentsPort,
} from '@/server/ports/payments/gateway';
import type { JobDefinition } from './registry';

type Context = Parameters<
  JobDefinition<typeof ProcessRefundPayloadSchema>['handleIdempotent']
>[0];

const SentRefundSchema = z.strictObject({
  refundId: z.uuid(),
  providerRefundId: z.string().min(1),
});

/**
 * Hands the fake provider's own event to the intake, the way the provider's webhook would. The event
 * came from this process's fake and is stored with the same row and job as a signed delivery, once:
 * a repeat of it writes nothing. A provider that delivers its own events needs none of this.
 */
async function deliverFakeRefundEvent(providerRefundId: string): Promise<void> {
  const event = await getFakePayments().lastEventFor(providerRefundId);
  if (!event) throw new Error('The fake provider emitted no refund event');
  const row = providerEventRow(event);
  if (row === null) throw new Error('The fake refund event is not storable');
  await recordProviderEvent(row);
}

/**
 * Before the job's transaction opens: sends the refund to the provider and, for the fake, hands its
 * event to the intake, so no connection is held during either. The provider key is the refund's
 * (`refund:{id}`) and the call carries the order's and the refund's ids (design doc 4.2.3 rules 6
 * and 8), so a retry of this job, or a crash before it commits, replays the same provider refund.
 * An error from the provider fails this try: the refund stays `pending` and the job retries, and a
 * job that runs out of tries raises the dead-job alert. Nothing here decides the refund's outcome:
 * only the provider's event does.
 */
export async function prepareRefund(payload: {
  refundId: string;
}): Promise<z.output<typeof SentRefundSchema> | null> {
  const toSend = await readRefundToSend(payload.refundId);
  if (!toSend) return null;
  const port = getPaymentsPort();
  const sent = await port.refund({
    idempotencyKey: toSend.providerKey,
    paymentId: toSend.providerPaymentId,
    amountMinor: toSend.amountMinor,
    metadata: { orderId: toSend.orderId, recordId: toSend.refundId },
  });
  if (handsOverProviderEvents(port.provider))
    await deliverFakeRefundEvent(sent.id);
  return { refundId: toSend.refundId, providerRefundId: sent.id };
}

/** Keeps the provider's id for the refund. Safe to run twice: the same id is kept once. */
export async function handleRefund({ tx, prepared }: Context): Promise<void> {
  const sent = SentRefundSchema.nullable().parse(prepared ?? null);
  if (sent === null) return;
  await recordProviderRefundId(tx, sent.refundId, sent.providerRefundId);
}
