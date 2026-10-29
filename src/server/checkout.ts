import 'server-only';
import {
  lookupVerdict,
  paymentTriesRefusal,
  providerStep,
  requiresPaymentResult,
  storesPayment,
  type ProviderStep,
  type StartPaymentInput,
  type StartPaymentResult,
} from '@/lib/checkout';
import { orderCurrency } from '@/lib/orders';
import {
  recordProviderPayment,
  startPaymentTx,
  type StartedPayment,
} from '@/server/db/checkout';
import type { Device } from '@/server/device';
import { logger } from '@/server/monitoring/logger';
import {
  PaymentsError,
  type Payment,
  type PaymentsPort,
} from '@/server/ports/payments';
import { getFakePayments } from '@/server/ports/payments/gateway';
import { consumeRateLimit } from '@/server/ports/rate-limit';

type Started = Extract<StartedPayment, { done: false }>;

/** Asks the provider for the attempt's payment, as the step says: read again, found by Ramble's ids, or created. */
async function providerPayment(
  payments: PaymentsPort,
  started: Started,
  step: ProviderStep,
): Promise<Payment> {
  const { attempt, order } = started;
  const metadata = { orderId: order.id, recordId: attempt.id };
  const found =
    step.step === 'retrieve'
      ? await payments.retrieve({ kind: 'payment', id: step.paymentId })
      : step.step === 'find_or_create'
        ? await payments.retrieve({ kind: 'payment', metadata })
        : null;
  const verdict = lookupVerdict(step, found !== null);
  if (found !== null && verdict === 'use') return found;
  if (verdict === 'refuse') {
    throw new PaymentsError('not_found', 'The payment is gone');
  }
  return payments.createPayment({
    idempotencyKey: attempt.providerKey,
    amountMinor: attempt.amountMinor,
    currency: orderCurrency,
    metadata,
  });
}

/**
 * Stores the provider's payment id on the attempt. A failure here does not fail the call: the
 * payment carries Ramble's ids, so its events still match the order (design doc 4.2.3, step 6).
 */
async function rememberPayment(
  device: Device,
  attemptId: string,
  payment: Payment,
): Promise<void> {
  try {
    const stored = await recordProviderPayment(device, attemptId, payment.id);
    if (!stored) logger.warn('Provider payment id not stored', { attemptId });
  } catch (error) {
    logger.error('Provider payment id not stored', {
      attemptId,
      errorKind: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/**
 * The whole of `startPayment` once the form has parsed: the hold's tries are spent before any lock
 * (a failed limit store throws, so it fails closed), then the first transaction, then the provider
 * between two short transactions, never inside one. Each decision is a function in `src/lib`.
 */
export async function startCheckoutPayment(
  device: Device,
  input: StartPaymentInput,
): Promise<StartPaymentResult> {
  const refused = paymentTriesRefusal(
    await consumeRateLimit('payment_tries', input.holdId),
  );
  if (refused) return refused;

  const payments = getFakePayments();
  const started = await startPaymentTx(device, input, payments.provider);
  if (started.done) return started.result;

  const step = providerStep(started.attempt);
  const payment = await providerPayment(payments, started, step);
  if (storesPayment(step)) {
    await rememberPayment(device, started.attempt.id, payment);
  }
  return requiresPaymentResult(
    started.order,
    { provider: payment.provider, clientSecret: payment.clientSecret },
    started.orderToken,
  );
}
