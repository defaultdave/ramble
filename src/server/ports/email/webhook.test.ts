import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDeliveryEvent } from '@/server/db/messages';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { setEnv, webhookSecret } from '../../../../tests/email/testEnv';
import { deliveryWebhookResponse } from './webhook';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/db/messages', () => ({ applyDeliveryEvent: vi.fn() }));
vi.mock('@/server/ports/rate-limit', () => ({ consumeRateLimit: vi.fn() }));

// Behaviours under test, one per decision, branch, or risk:
// - with no webhook secret configured every request gets 503, is not counted, and nothing is written
// - a request with no credentials, the wrong secret, or the right secret in the wrong scheme gets 401 and nothing is written
// - a failed verification is counted against the caller's own address (the first x-forwarded-for entry, else "unknown")
// - a source past the failed-verification limit gets 429 with Retry-After, and nothing is written
// - a verified request is never counted on the failure counter, so bad traffic cannot refuse it, even when that counter refuses everyone
// - a verified request is counted on the verified-traffic cap; over it gets 429 with Retry-After and nothing is written
// - a limiter store failure is thrown, not let through
// - a body over 64 KB gets 413, declared or discovered while reading, before any count or write
// - a verified body that is not an event gets 400
// - a verified delivery event gets 200 and is applied once; one Ramble ignores gets 200 and is not applied
// - the answer is an empty body

const url = 'http://localhost/api/webhooks/email';
const event = JSON.stringify({ messageId: 'fake-1', event: 'hard_bounce' });
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

function post(body: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'POST', body, headers });
}

const respond = (request: Request, nowSeconds = 0) =>
  deliveryWebhookResponse(request, nowSeconds);

const signedSecret = `whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;

function svixHeaders(body: string, timestamp: number): Record<string, string> {
  const signature = createHmac(
    'sha256',
    Buffer.from(signedSecret.replace('whsec_', ''), 'base64'),
  )
    .update(`msg_1.${String(timestamp)}.${body}`)
    .digest('base64');
  return {
    'svix-id': 'msg_1',
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${signature}`,
  };
}

const allowed = { allowed: true, remaining: 1 } as const;

beforeEach(() => {
  setEnv(testEnv, { EMAIL_WEBHOOK_SECRET: webhookSecret });
  vi.mocked(applyDeliveryEvent).mockReset();
  vi.mocked(consumeRateLimit).mockReset().mockResolvedValue(allowed);
});

describe('deliveryWebhookResponse', () => {
  it('answers 503 while no webhook secret is configured, uncounted', async () => {
    setEnv(testEnv);

    const response = await respond(post(event, bearer(webhookSecret)));

    expect(response.status).toBe(503);
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['no credentials', {}],
    ['the wrong secret', bearer(`${webhookSecret}x`)],
    [
      'the right secret in the wrong scheme',
      { authorization: `Basic ${webhookSecret}` },
    ],
    ['an empty bearer token', { authorization: 'Bearer ' }],
  ])('refuses %s with an empty 401 and writes nothing', async (_l, headers) => {
    const response = await respond(post(event, headers));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['the first x-forwarded-for entry', '203.0.113.7, 10.0.0.1', '203.0.113.7'],
    ['an IPv6 address in lower case', '2001:DB8::1', '2001:db8::1'],
    ['unknown when the header is absent', undefined, 'unknown'],
    ['unknown when the header is not an address', 'not an address!', 'unknown'],
  ])('counts a failure against %s', async (_label, forwarded, subject) => {
    await respond(
      post(event, forwarded ? { 'x-forwarded-for': forwarded } : {}),
    );

    expect(consumeRateLimit).toHaveBeenCalledExactlyOnceWith(
      'email_webhook_failed',
      subject,
    );
  });

  it('answers 429 with Retry-After to a source past the failure limit, and writes nothing', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });

    const response = await respond(post(event));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it('never counts a verified request as a failure, so bad traffic cannot refuse it', async () => {
    vi.mocked(consumeRateLimit).mockImplementation((surface) =>
      Promise.resolve(
        surface === 'email_webhook_failed'
          ? { allowed: false, retryAfterSeconds: 600 }
          : allowed,
      ),
    );

    const response = await respond(post(event, bearer(webhookSecret)));

    expect(response.status).toBe(200);
    expect(consumeRateLimit).toHaveBeenCalledExactlyOnceWith(
      'email_webhook',
      'provider',
    );
    expect(applyDeliveryEvent).toHaveBeenCalledOnce();
  });

  it('answers 429 with Retry-After to a verified request over the verified cap, and writes nothing', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 9,
    });

    const response = await respond(post(event, bearer(webhookSecret)));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('9');
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it('fails closed when the limiter store fails', async () => {
    vi.mocked(consumeRateLimit).mockRejectedValue(new Error('store down'));

    await expect(respond(post(event, bearer(webhookSecret)))).rejects.toThrow(
      'store down',
    );
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it('refuses a declared body over 64 KB unread, uncounted', async () => {
    const response = await respond(
      post(event, { ...bearer(webhookSecret), 'content-length': '70000' }),
    );

    expect(response.status).toBe(413);
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it('refuses a body that grows past 64 KB while it is read', async () => {
    const response = await respond(
      post('x'.repeat(64 * 1024 + 1), bearer(webhookSecret)),
    );

    expect(response.status).toBe(413);
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it('reads a body of exactly 64 KB, which is then refused as not an event', async () => {
    const response = await respond(
      post('x'.repeat(64 * 1024), bearer(webhookSecret)),
    );

    expect(response.status).toBe(400);
  });

  it.each(['not json', '{}', '{"messageId":"m","event":"opened"}'])(
    'answers 400 to the verified body %j',
    async (body) => {
      const response = await respond(post(body, bearer(webhookSecret)));

      expect(response.status).toBe(400);
      expect(applyDeliveryEvent).not.toHaveBeenCalled();
    },
  );

  it('applies a verified delivery event once', async () => {
    const response = await respond(post(event, bearer(webhookSecret)));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(applyDeliveryEvent).toHaveBeenCalledExactlyOnceWith('fake', {
      providerMessageId: 'fake-1',
      kind: 'hard_bounce',
    });
  });

  it('answers 200 to a verified event kind it ignores, without applying it', async () => {
    setEnv(testEnv, {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'key',
      EMAIL_WEBHOOK_SECRET: signedSecret,
    });
    const body = JSON.stringify({ type: 'email.opened', data: {} });

    const response = await respond(post(body, svixHeaders(body, 1_000)), 1_000);

    expect(response.status).toBe(200);
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });
});
