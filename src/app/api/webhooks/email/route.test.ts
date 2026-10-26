import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDeliveryEvent } from '@/server/db/messages';
import { setEnv, webhookSecret } from '../../../../../tests/email/testEnv';
import { POST } from './route';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/db/messages', () => ({ applyDeliveryEvent: vi.fn() }));

// Behaviours under test, one per decision or risk:
// - an unauthenticated request gets an empty 401 and writes nothing
// - an authenticated request gets 200 and is applied
// - the route passes the current time on, so a signed Resend webhook is judged against it

const url = 'http://localhost/api/webhooks/email';
const event = JSON.stringify({ messageId: 'fake-1', event: 'hard_bounce' });
const signedSecret = `whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;

function post(body: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'POST', body, headers });
}

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

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/webhooks/email', () => {
  it('refuses an unauthenticated request with an empty 401', async () => {
    const response = await POST(post(event));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(applyDeliveryEvent).not.toHaveBeenCalled();
  });

  it('accepts an authenticated request', async () => {
    const response = await POST(
      post(event, { authorization: `Bearer ${webhookSecret}` }),
    );

    expect(response.status).toBe(200);
    expect(applyDeliveryEvent).toHaveBeenCalledOnce();
  });

  it('judges a signed webhook against the current time', async () => {
    setEnv(testEnv, {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'key',
      EMAIL_WEBHOOK_SECRET: signedSecret,
    });
    const body = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 're_1' },
    });
    const signedAt = 1_790_000_000;
    vi.useFakeTimers({ now: signedAt * 1000 });

    const fresh = await POST(post(body, svixHeaders(body, signedAt)));
    vi.setSystemTime((signedAt + 600) * 1000);
    const stale = await POST(post(body, svixHeaders(body, signedAt)));

    expect(fresh.status).toBe(200);
    expect(stale.status).toBe(401);
  });
});
