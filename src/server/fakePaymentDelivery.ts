import 'server-only';
import { after } from 'next/server';
import {
  fakeDrainTime,
  fakeDrainWaitMs,
  recallsStoredSuccess,
  type FakeConfirmPlan,
} from '@/lib/fakePayment';
import { drainJobs } from '@/server/jobs/drain';
import { logger } from '@/server/monitoring/logger';
import { signatureHeader, takePaymentWebhook } from '@/server/paymentWebhook';
import { fixedClock, systemClock } from '@/server/ports/clock';
import { getFakePayments } from '@/server/ports/payments/gateway';

// The request never leaves this process; the route code only needs something to read.
const deliveryUrl = 'http://localhost/api/webhooks/payments';

/** Waits for `work` to settle, success or failure, but never longer than `ms`, and leaves no timer behind. */
async function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([Promise.allSettled([work]), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Answers a retry of a success with the stored event, and anything else with a fresh confirmation. */
async function confirmOrRecall(
  fake: ReturnType<typeof getFakePayments>,
  paymentId: string,
  plan: FakeConfirmPlan,
) {
  const last = await fake.lastEventFor(paymentId);
  if (last && recallsStoredSuccess(plan, last)) return { event: last };
  return fake.confirm(paymentId, plan);
}

/**
 * Plays the guest's confirmation at the fake gateway and hands its event to the webhook intake the way
 * a real provider would, so the order moves without anyone calling the webhook by hand. The event is
 * signed here and checked by the same route code in this process, which is why the fake's webhook
 * secret needs no setting. Once the intake has taken it, the job it queued is drained, and the reply
 * waits for that for a few seconds so the page the guest lands on already shows the result. `after`
 * keeps the work alive past the reply; a failed drain is logged here and never fails the guest, who has
 * paid: the job stays due. A refused delivery throws, naming only the kind, and the fake keeps the
 * payment's event: when the guest retries, that same event is delivered again (the intake stores it
 * once however often it arrives) instead of the fake refusing a second success.
 */
// TODO(U-046): Stripe delivers its own events; this stays for the fake only.
export async function deliverFakeConfirmation(
  paymentId: string,
  plan: FakeConfirmPlan,
): Promise<void> {
  const fake = getFakePayments();
  const { event } = await confirmOrRecall(fake, paymentId, plan);
  const { rawBody, signature } = fake.signWebhook(event);
  const outcome = await takePaymentWebhook(
    new Request(deliveryUrl, {
      method: 'POST',
      headers: { [signatureHeader]: signature },
      body: rawBody,
    }),
  );
  if (outcome.kind !== 'accepted') {
    logger.error('fake payment delivery refused', {
      kind: 'delivery_refused',
      outcome: outcome.kind,
    });
    throw new Error('The fake payment event was not taken');
  }
  const drained = drainJobs(fixedClock(fakeDrainTime(systemClock.now()))).catch(
    (error: unknown) => {
      logger.error('fake payment drain failed', {
        errorName: error instanceof Error ? error.name : 'NonError',
      });
    },
  );
  after(drained);
  await settleWithin(drained, fakeDrainWaitMs);
}
