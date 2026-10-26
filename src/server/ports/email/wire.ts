import 'server-only';
import type { z } from 'zod';
import type { EmailAdapterName } from '@/lib/email/message';
import { readBodyText } from '@/server/boundedBody';
import { EmailProviderError, WebhookPayloadError } from './errors';

const sendTimeoutMs = 10_000;
const maxErrorDetailLength = 200;
const maxResponseBytes = 64 * 1024;

type PostJson = {
  adapter: EmailAdapterName;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

/** The provider's explanation, for the log only: the status alone decides whether to retry. */
async function refusalDetail(response: Response): Promise<string> {
  try {
    const { text } = await readBodyText(response, maxErrorDetailLength * 4);
    const detail = text.slice(0, maxErrorDetailLength).replaceAll(/\s+/g, ' ');
    return detail ? `: ${detail}` : '';
  } catch {
    return ' (the body could not be read)';
  }
}

/**
 * One bounded POST to a provider. A network failure, a timeout, a 429, and a 5xx are retryable;
 * any other refusal is not, because sending the same message again would be refused again.
 */
export async function postJson({
  adapter,
  url,
  headers,
  body,
}: PostJson): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(sendTimeoutMs),
    });
  } catch (cause) {
    throw new EmailProviderError(adapter, 'the request did not complete', {
      retryable: true,
      cause,
    });
  }
  if (!response.ok) {
    throw new EmailProviderError(
      adapter,
      `responded ${String(response.status)}${await refusalDetail(response)}`,
      { retryable: response.status === 429 || response.status >= 500 },
    );
  }
  // The provider took the message, so a second send could deliver it twice: nothing below retries.
  const { text, exceeded } = await readBodyText(
    response,
    maxResponseBytes,
  ).catch((cause: unknown) => {
    throw new EmailProviderError(adapter, 'the response could not be read', {
      retryable: false,
      cause,
    });
  });
  if (exceeded) {
    throw new EmailProviderError(adapter, 'the response was too large', {
      retryable: false,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new EmailProviderError(adapter, 'the response was not JSON', {
      retryable: false,
      cause,
    });
  }
}

export function parseSendResponse<Schema extends z.ZodType>(
  adapter: EmailAdapterName,
  schema: Schema,
  body: unknown,
): z.infer<Schema> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new EmailProviderError(adapter, 'the response had no message ID', {
      retryable: false,
    });
  }
  return parsed.data;
}

export function parseWebhookBody<Schema extends z.ZodType>(
  adapter: EmailAdapterName,
  schema: Schema,
  rawBody: string,
): z.infer<Schema> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new WebhookPayloadError(adapter);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new WebhookPayloadError(adapter);
  return parsed.data;
}
