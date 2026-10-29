'use server';

import {
  StartPaymentInputSchema,
  invalidStartPayment,
  paymentTriesRefusal,
  providerStep,
  requiresPaymentResult,
  type StartPaymentInput,
  type StartPaymentResult,
} from '@/lib/checkout';
import { orderCurrency } from '@/lib/orders';
import {
  recordProviderPayment,
  startPaymentTx,
  type StartedPayment,
} from '@/server/db/checkout';
import { getDevice, type Device } from '@/server/device';
import { logger } from '@/server/monitoring/logger';
import {
  PaymentsError,
  type Payment,
  type PaymentsPort,
} from '@/server/ports/payments';
import { getFakePayments } from '@/server/ports/payments/gateway';
import { consumeRateLimit } from '@/server/ports/rate-limit';

type Started = Extract<StartedPayment, { done: false }>;

/** Asks the provider for the attempt's payment: read again, found by Ramble's ids, or created. */
async function providerPayment(
  payments: PaymentsPort,
  started: Started,
): Promise<Payment> {
  const { attempt, order } = started;
  const step = providerStep(attempt);
  if (step.step === 'retrieve') {
    const found = await payments.retrieve({
      kind: 'payment',
      id: step.paymentId,
    });
    // A payment id the provider no longer knows is not repaired by making another: the guest
    // would be asked to pay for a payment Ramble cannot match.
    if (!found) throw new PaymentsError('not_found', 'The payment is gone');
    return found;
  }
  const metadata = { orderId: order.id, recordId: attempt.id };
  const existing =
    step.step === 'find_or_create'
      ? await payments.retrieve({ kind: 'payment', metadata })
      : null;
  return (
    existing ??
    payments.createPayment({
      idempotencyKey: attempt.providerKey,
      amountMinor: attempt.amountMinor,
      currency: orderCurrency,
      metadata,
    })
  );
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

// TODO(U-047b): first caller, the checkout page.
/**
 * Turns the caller's open hold into an order and a live payment attempt, and hands back the
 * client secret to pay it with. Safe to call again: a second tab, a refresh, or a retry after a
 * decline reaches the same order and the same attempt (PRD-22). The form is parsed and the hold's
 * five tries are spent before any lock is taken; a failed limit store throws, so it fails closed.
 * The provider is called between two short transactions, never inside one.
 */
export async function startPayment(
  input: StartPaymentInput,
): Promise<StartPaymentResult> {
  const parsed = StartPaymentInputSchema.safeParse(input);
  if (!parsed.success) return invalidStartPayment(parsed.error.issues);
  const device = await getDevice();
  const refused = paymentTriesRefusal(
    await consumeRateLimit('payment_tries', parsed.data.holdId),
  );
  if (refused) return refused;

  const payments = getFakePayments();
  const started = await startPaymentTx(device, parsed.data, payments.provider);
  if (started.done) return started.result;

  const payment = await providerPayment(payments, started);
  if (started.attempt.providerPaymentId === null) {
    await rememberPayment(device, started.attempt.id, payment);
  }
  return requiresPaymentResult(
    started.order,
    { provider: payment.provider, clientSecret: payment.clientSecret },
    started.orderToken,
  );
}
