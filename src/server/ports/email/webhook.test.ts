import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDeliveryEvent } from '@/server/db/messages';
import { setEnv, webhookSecret } from '../../../../tests/email/testEnv';
import { receiveDeliveryWebhook } from './webhook';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/db/messages', () => ({ applyDeliveryEvent: vi.fn() }));

// Behaviours under test, one per decision, branch, or risk:
// - with no webhook secret configured every request gets 503 and nothing is written
// - a request with no credentials, the wrong secret, or the right secret in the wrong scheme gets 401 and nothing is written
// - a body over 64 KB gets 413, whether the length is declared or only discovered while reading, and nothing is written
// - an authenticated body that is not an event gets 400
// - an authenticated delivery event gets 200 and is applied to the log once
// - an authenticated event Ramble ignores gets 200 and is not applied

const url = 'http://localhost/api/webhooks/email';
const event = JSON.stringify({ messageId: 'fake-1', event: 'hard_bounce' });
const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

function post(body: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'POST', body, headers });
}

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

beforeEach(() => {
  setEnv(testEnv, { EMAIL_WEBHOOK_SECRET: webhookSecret });
  vi.mocked(applyDeliveryEvent).mockReset();
});

describe('receiveDeliveryWebhook', () => {
  it('answers 503 while no webhook secret is configured', async () => {
    setEnv(testEnv);

    const result = await receiveDeliveryWebhook(
      post(event, bearer(webhookSecret)),
      0,
    );

    expect(result.status).toBe(503);
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
  ])('refuses %s with 401 and writes nothing', async (_label, headers) => {
    const result = await receiveDeliveryWebhook(post(event, headers), 0);

    expect(result.status).toBe(401);
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it('refuses a declared body over 64 KB without reading it', async () => {
    const result = await receiveDeliveryWebhook(
      post(event, { ...bearer(webhookSecret), 'content-length': '70000' }),
      0,
    );

    expect(result.status).toBe(413);
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it('refuses a body that grows past 64 KB while it is read', async () => {
    const result = await receiveDeliveryWebhook(
      post('x'.repeat(64 * 1024 + 1), bearer(webhookSecret)),
      0,
    );

    expect(result.status).toBe(413);
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it('accepts a body of exactly 64 KB, which is then refused as not an event', async () => {
    const result = await receiveDeliveryWebhook(
      post('x'.repeat(64 * 1024), bearer(webhookSecret)),
      0,
    );

    expect(result.status).toBe(400);
  });

  it.each(['not json', '{}', '{"messageId":"m","event":"opened"}'])(
    'answers 400 to the authenticated body %j',
    async (body) => {
      const result = await receiveDeliveryWebhook(
        post(body, bearer(webhookSecret)),
        0,
      );

      expect(result.status).toBe(400);
      expect(applyDeliveryEvent).not.toHaveBeenCalled();
    },
  );

  it('applies an authenticated delivery event once', async () => {
    const result = await receiveDeliveryWebhook(
      post(event, bearer(webhookSecret)),
      0,
    );

    expect(result.status).toBe(200);
    expect(applyDeliveryEvent).toHaveBeenCalledExactlyOnceWith('fake', {
      providerMessageId: 'fake-1',
      kind: 'hard_bounce',
    });
  });

  it('answers 200 to an event kind it ignores, without applying it', async () => {
    setEnv(testEnv, {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'key',
      EMAIL_WEBHOOK_SECRET: signedSecret,
    });
    const body = JSON.stringify({ type: 'email.opened', data: {} });

    const result = await receiveDeliveryWebhook(
      post(body, svixHeaders(body, 1_000)),
      1_000,
    );

    expect(result.status).toBe(200);
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });
});
