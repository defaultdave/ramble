import 'server-only';
import { clientAddress } from '@/lib/clientAddress';
import { declaredLengthExceeds } from '@/lib/email/message';
import { providerEventRow } from '@/lib/providerEvents';
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

type WebhookResult =
  { status: 200 | 400 | 413 } | { status: 429; retryAfterSeconds: number };

type Verified = Awaited<ReturnType<PaymentsPort['verifyWebhook']>>;

/** A refused signature is a PaymentsError of these kinds; anything else is a provider fault and surfaces. */
async function verify(
  port: PaymentsPort,
  rawBody: string,
  signature: string | null,
): Promise<Verified | null> {
  if (signature === null) return null;
  try {
    return await port.verifyWebhook({ rawBody, signature });
  } catch (error) {
    if (
      error instanceof PaymentsError &&
      (error.code === 'invalid_signature' || error.code === 'invalid_input')
    ) {
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
async function handlePaymentWebhook(request: Request): Promise<WebhookResult> {
  if (
    declaredLengthExceeds(
      request.headers.get('content-length'),
      maxWebhookBodyLength,
    )
  ) {
    return { status: 413 };
  }
  const { text: rawBody, exceeded } = await readBodyText(
    request,
    maxWebhookBodyLength,
  );
  if (exceeded) return { status: 413 };

  const port = getPaymentsPort();
  const verified = await verify(
    port,
    rawBody,
    request.headers.get(signatureHeader),
  );
  if (verified === null) {
    logger.warn('payment webhook refused', { kind: 'invalid_signature' });
    const failures = await consumeRateLimit(
      'payment_webhook_failed',
      clientAddress(request.headers.get('x-forwarded-for')),
    );
    return failures.allowed
      ? { status: 400 }
      : { status: 429, retryAfterSeconds: failures.retryAfterSeconds };
  }

  const budget = await consumeRateLimit('payment_webhook', 'provider');
  if (!budget.allowed) {
    return { status: 429, retryAfterSeconds: budget.retryAfterSeconds };
  }

  if (verified.status === 'ignored') return { status: 200 };
  const row = providerEventRow(verified.event);
  if (row === null) {
    logger.warn('payment webhook refused', { kind: 'event_not_storable' });
    return { status: 400 };
  }
  await recordProviderEvent(row);
  return { status: 200 };
}

/** The HTTP answer for a payment webhook: empty, with `Retry-After` when the caller is told to slow down. */
export async function paymentWebhookResponse(
  request: Request,
): Promise<Response> {
  const result = await handlePaymentWebhook(request);
  return result.status === 429
    ? new Response(null, {
        status: 429,
        headers: { 'retry-after': String(result.retryAfterSeconds) },
      })
    : new Response(null, { status: result.status });
}
