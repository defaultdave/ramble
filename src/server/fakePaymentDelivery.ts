import 'server-only';
import { after } from 'next/server';
import type { FakeConfirmPlan } from '@/lib/fakePayment';
import { isDeliveryTaken } from '@/lib/providerEvents';
import { drainJobs } from '@/server/jobs/drain';
import { logger } from '@/server/monitoring/logger';
import { getFakePayments } from '@/server/ports/payments/gateway';
import { systemClock } from '@/server/ports/clock';
import { paymentWebhookResponse } from '@/server/paymentWebhook';

// The header and path the webhook route reads; the request never leaves this process.
const signatureHeader = 'x-ramble-signature';
const deliveryUrl = 'http://localhost/api/webhooks/payments';

async function drainAfterDelivery(): Promise<void> {
  try {
    await drainJobs(systemClock);
  } catch (error) {
    // The guest has paid and the event is stored, so the job stays due for the next drain.
    logger.error('fake payment drain failed', {
      errorKind: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/**
 * Plays the guest's confirmation at the fake gateway and hands its event to the webhook intake the way
 * a real provider would, so the order moves without anyone calling the webhook by hand. The event is
 * signed here and checked by the same route code in this process, which is why the fake's webhook
 * secret needs no setting. Once the intake has taken it, the job it queued is drained after the
 * response, with no pulse needed. A refused delivery throws, naming only the kind: the fake has the
 * payment and Ramble does not, so the guest must be told to wait rather than to pay again.
 */
// TODO(U-046): Stripe delivers its own events; this stays for the fake only.
export async function deliverFakeConfirmation(
  paymentId: string,
  plan: FakeConfirmPlan,
): Promise<void> {
  const fake = getFakePayments();
  const { event } = await fake.confirm(paymentId, plan);
  const { rawBody, signature } = fake.signWebhook(event);
  const response = await paymentWebhookResponse(
    new Request(deliveryUrl, {
      method: 'POST',
      headers: { [signatureHeader]: signature },
      body: rawBody,
    }),
  );
  if (!isDeliveryTaken(response.status)) {
    logger.error('fake payment delivery refused', {
      kind: 'delivery_refused',
      status: response.status,
    });
    throw new Error('The fake payment event was not taken');
  }
  after(drainAfterDelivery);
}
