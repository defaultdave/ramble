import 'server-only';
import { readBodyText } from '@/server/boundedBody';
import { clientAddress } from '@/lib/clientAddress';
import { declaredLengthExceeds } from '@/lib/email/message';
import { applyDeliveryEvent } from '@/server/db/messages';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { getAdapter, getEmailConfig } from './config';
import { WebhookPayloadError } from './errors';

const maxBodyBytes = 64 * 1024;

type WebhookResult =
  | { status: 200 | 400 | 401 | 413 | 503 }
  | { status: 429; retryAfterSeconds: number };

/**
 * Takes a provider's delivery webhook. The signature or secret is checked against the raw body
 * (read under a 64 KB cap) before anything is parsed or written. A request that fails the check
 * is counted against its own source address and refused; one that passes is never held back by
 * what unauthenticated callers did, only by a separate cap on verified traffic. Events are
 * idempotent (a status only moves toward a worse outcome), so a provider's retry is harmless.
 */
async function handleDeliveryWebhook(
  request: Request,
  nowSeconds: number,
): Promise<WebhookResult> {
  const config = getEmailConfig();
  if (!config.webhookSecret) return { status: 503 };

  // A declared length past the limit is refused unread; the stream check catches an undeclared one.
  if (
    declaredLengthExceeds(request.headers.get('content-length'), maxBodyBytes)
  ) {
    return { status: 413 };
  }
  const { text: rawBody, exceeded } = await readBodyText(request, maxBodyBytes);
  if (exceeded) return { status: 413 };

  const adapter = getAdapter(config.provider);
  if (
    !adapter.verifyWebhook({ headers: request.headers, rawBody, nowSeconds })
  ) {
    const failures = await consumeRateLimit(
      'email_webhook_failed',
      clientAddress(request.headers.get('x-forwarded-for')),
    );
    return failures.allowed
      ? { status: 401 }
      : { status: 429, retryAfterSeconds: failures.retryAfterSeconds };
  }

  const budget = await consumeRateLimit('email_webhook', 'provider');
  if (!budget.allowed) {
    return { status: 429, retryAfterSeconds: budget.retryAfterSeconds };
  }

  try {
    const event = adapter.parseWebhook(rawBody);
    if (event) await applyDeliveryEvent(adapter.name, event);
  } catch (error) {
    if (error instanceof WebhookPayloadError) return { status: 400 };
    throw error;
  }
  return { status: 200 };
}

/** The HTTP answer for a webhook: empty, with `Retry-After` when the caller is told to slow down. */
export async function deliveryWebhookResponse(
  request: Request,
  nowSeconds: number,
): Promise<Response> {
  const result = await handleDeliveryWebhook(request, nowSeconds);
  return result.status === 429
    ? new Response(null, {
        status: 429,
        headers: { 'retry-after': String(result.retryAfterSeconds) },
      })
    : new Response(null, { status: result.status });
}
