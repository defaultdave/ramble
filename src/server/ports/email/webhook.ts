import 'server-only';
import { readBodyText } from '@/server/boundedBody';
import { applyDeliveryEvent } from '@/server/db/messages';
import { getAdapter, getEmailConfig } from './config';
import { WebhookPayloadError } from './errors';

const maxBodyBytes = 64 * 1024;

type WebhookStatus = 200 | 400 | 401 | 413 | 503;

/**
 * Takes a provider's delivery webhook. The signature or secret is checked against the raw body
 * before the body is read as JSON, and nothing is written for a request that fails the check. Events
 * are idempotent (a status only moves toward a worse outcome), so a provider's retry is harmless.
 */
export async function receiveDeliveryWebhook(
  request: Request,
  nowSeconds: number,
): Promise<{ status: WebhookStatus }> {
  const config = getEmailConfig();
  if (!config.webhookSecret) return { status: 503 };

  // A declared length past the limit is refused unread; the stream check catches an undeclared one.
  if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) {
    return { status: 413 };
  }
  const { text: rawBody, exceeded } = await readBodyText(request, maxBodyBytes);
  if (exceeded) return { status: 413 };

  const adapter = getAdapter(config.provider);
  if (
    !adapter.verifyWebhook({ headers: request.headers, rawBody, nowSeconds })
  ) {
    return { status: 401 };
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
