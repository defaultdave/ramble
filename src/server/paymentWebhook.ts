import 'server-only';
import { clientAddress } from '@/lib/clientAddress';
import { declaredLengthExceeds } from '@/lib/email/message';
import {
  intakeResponse,
  isRefusedSignature,
  providerEventRow,
  type IntakeOutcome,
} from '@/lib/providerEvents';
import { readBodyText } from '@/server/boundedBody';
import { recordProviderEvent } from '@/server/db/providerEvents';
import { logger } from '@/server/monitoring/logger';
import {
  PaymentsError,
  maxWebhookBodyLength,
  type PaymentsPort,
} from '@/server/ports/payments';
import { getPaymentsPort } from '@/server/ports/payments/gateway';
import { consumeRateLimit } from '@/server/ports/rate-limit';

/** The header the fake gateway signs with; the Stripe adapter reads `stripe-signature` instead. */
const signatureHeader = 'x-ramble-signature';

type Verified = Awaited<ReturnType<PaymentsPort['verifyWebhook']>>;

/** Null for a refused signature; a provider fault (anything else) surfaces. */
async function verify(
  port: PaymentsPort,
  rawBody: string,
  signature: string | null,
): Promise<Verified | null> {
  if (signature === null) return null;
  try {
    return await port.verifyWebhook({ rawBody, signature });
  } catch (error) {
    if (error instanceof PaymentsError && isRefusedSignature(error.code)) {
      return null;
    }
    throw error;
  }
}

/**
 * Takes the payment provider's webhook. The body is read under a cap, and its signature is
 * checked on the raw text before anything is parsed or written. A refused delivery is counted
 * against its own source address and writes nothing; a genuine one is stored once with its job
 * and answered 2xx, however often the provider repeats it. The signature is the capability, so
 * the route takes no `Caller`. Only the kind of a refusal is logged, never the body.
 */
async function takePaymentWebhook(request: Request): Promise<IntakeOutcome> {
  if (
    declaredLengthExceeds(
      request.headers.get('content-length'),
      maxWebhookBodyLength,
    )
  ) {
    return { kind: 'too_large' };
  }
  const { text: rawBody, exceeded } = await readBodyText(
    request,
    maxWebhookBodyLength,
  );
  if (exceeded) return { kind: 'too_large' };

  const verified = await verify(
    getPaymentsPort(),
    rawBody,
    request.headers.get(signatureHeader),
  );
  if (verified === null) {
    logger.warn('payment webhook refused', { kind: 'invalid_signature' });
    return {
      kind: 'refused',
      failures: await consumeRateLimit(
        'payment_webhook_failed',
        clientAddress(request.headers.get('x-forwarded-for')),
      ),
    };
  }

  const budget = await consumeRateLimit('payment_webhook', 'provider');
  if (!budget.allowed) return { kind: 'over_budget', budget };

  if (verified.status === 'ignored') return { kind: 'accepted' };
  const row = providerEventRow(verified.event);
  if (row === null) {
    logger.warn('payment webhook refused', { kind: 'event_not_storable' });
    return { kind: 'unstorable' };
  }
  await recordProviderEvent(row);
  return { kind: 'accepted' };
}

/** The HTTP answer for a payment webhook: empty, with `Retry-After` when the caller is told to slow down. */
export async function paymentWebhookResponse(
  request: Request,
): Promise<Response> {
  const result = intakeResponse(await takePaymentWebhook(request));
  return result.status === 429
    ? new Response(null, {
        status: 429,
        headers: { 'retry-after': String(result.retryAfterSeconds) },
      })
    : new Response(null, { status: result.status });
}
