import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordProviderEvent } from '@/server/db/providerEvents';
import { logger } from '@/server/monitoring/logger';
import { maxWebhookBodyLength, PaymentsError } from '@/server/ports/payments';
import { createFakePaymentsAdapter } from '@/server/ports/payments/fake';
import { getFakePayments } from '@/server/ports/payments/gateway';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { POST } from './route';

vi.mock('@/server/db/providerEvents', () => ({ recordProviderEvent: vi.fn() }));
vi.mock('@/server/ports/rate-limit', () => ({ consumeRateLimit: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision or risk:
// - a delivery with no signature, a forged one, and one signed for another body get an empty 400, write nothing, and are
//   counted against their source address; the log names the kind and never the body
// - too many refused deliveries from one address get 429 with a Retry-After header
// - a body over the cap gets 413 before it is verified or stored, declared by Content-Length or only found while reading
// - a genuine event is stored once (the route answers 200 again for a repeat) with the metadata ids from the object
// - a genuine event of a type Ramble does not handle gets 200 and stores nothing
// - verified traffic over its own budget gets 429
// - a genuine event the table could not hold is refused with 400 and stored nowhere
// - a provider fault while verifying is not mistaken for a bad signature: it surfaces

const orderId = '00000000-0000-4000-8000-0000000000a1';
const recordId = '00000000-0000-4000-8000-0000000000b2';
const url = 'http://localhost/api/webhooks/payments';
// The gateway signs and checks deliveries without a database; the events come from an adapter on its own
// in-memory state, which signs with another secret, so the gateway signs them again.
const fake = getFakePayments();
const provider = createFakePaymentsAdapter({
  webhookSecret: 'w'.repeat(32),
  now: () => new Date(),
});

function post(
  body: string,
  headers: Record<string, string> = {},
  signature?: string,
) {
  return new Request(url, {
    method: 'POST',
    body,
    headers: {
      ...(signature === undefined ? {} : { 'x-ramble-signature': signature }),
      ...headers,
    },
  });
}

let counter = 0;
async function emitSucceeded() {
  counter += 1;
  const payment = await provider.createPayment({
    idempotencyKey: `pay:route-test:${String(counter)}`,
    amountMinor: 13_000,
    currency: 'USD',
    metadata: { orderId, recordId },
  });
  const { event } = await provider.confirm(payment.id, {
    outcome: 'succeeded',
    method: 'apple_pay',
  });
  return event;
}

beforeEach(() => {
  vi.mocked(recordProviderEvent).mockReset().mockResolvedValue('stored');
  vi.mocked(consumeRateLimit)
    .mockReset()
    .mockResolvedValue({ allowed: true, remaining: 1 });
  vi.mocked(logger.warn).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/webhooks/payments', () => {
  it('refuses a delivery with no signature, and counts it', async () => {
    const event = await emitSucceeded();
    const response = await POST(post(JSON.stringify(event)));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(recordProviderEvent).not.toHaveBeenCalled();
    expect(consumeRateLimit).toHaveBeenCalledWith(
      'payment_webhook_failed',
      'unknown',
    );
  });

  it.each([
    ['a malformed signature', () => 'nope'],
    [
      'a signature that does not match the body',
      () => fake.signBody('{"another":"body"}').signature,
    ],
  ])('refuses %s without logging the body', async (_name, signature) => {
    const event = await emitSucceeded();
    const body = JSON.stringify(event);
    const response = await POST(post(body, {}, signature()));

    expect(response.status).toBe(400);
    expect(recordProviderEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('payment webhook refused', {
      kind: 'invalid_signature',
    });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      event.objectId,
    );
  });

  it('counts a refused delivery against the forwarded address', async () => {
    await POST(post('{}', { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, 'x'));

    expect(consumeRateLimit).toHaveBeenCalledWith(
      'payment_webhook_failed',
      '203.0.113.9',
    );
  });

  it('answers 429 with Retry-After once an address has been refused too often', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const response = await POST(post('{}', {}, 'x'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
  });

  it('refuses a declared length over the cap before reading it', async () => {
    const response = await POST(
      post('{}', { 'content-length': String(maxWebhookBodyLength + 1) }, 'x'),
    );

    expect(response.status).toBe(413);
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(recordProviderEvent).not.toHaveBeenCalled();
  });

  it('refuses a body that only turns out too large while it is read', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maxWebhookBodyLength + 1));
        controller.close();
      },
    });
    const response = await POST(
      new Request(url, {
        method: 'POST',
        body,
        duplex: 'half',
        headers: { 'x-ramble-signature': 'x' },
      } as RequestInit),
    );

    expect(response.status).toBe(413);
    expect(recordProviderEvent).not.toHaveBeenCalled();
  });

  it('stores a genuine event with the ids from its metadata, and answers 200', async () => {
    const event = await emitSucceeded();
    const { rawBody, signature } = fake.signWebhook(event);
    const response = await POST(post(rawBody, {}, signature));

    expect(response.status).toBe(200);
    expect(recordProviderEvent).toHaveBeenCalledTimes(1);
    expect(recordProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'fake',
        providerEventId: event.id,
        type: 'payment.succeeded',
        objectId: event.objectId,
        rambleOrderId: orderId,
        rambleRecordId: recordId,
        amountMinor: 13_000,
        currency: 'USD',
      }),
    );
  });

  it('answers 200 again for a repeat of an event it already stored', async () => {
    vi.mocked(recordProviderEvent).mockResolvedValue('repeat');
    const event = await emitSucceeded();
    const { rawBody, signature } = fake.signWebhook(event);

    expect((await POST(post(rawBody, {}, signature))).status).toBe(200);
  });

  it('answers 200 and stores nothing for a genuine event of a type it does not handle', async () => {
    const { rawBody, signature } = fake.signBody(
      JSON.stringify({ id: 'evt_x', provider: 'fake', type: 'ignored.type' }),
    );
    const response = await POST(post(rawBody, {}, signature));

    expect(response.status).toBe(200);
    expect(recordProviderEvent).not.toHaveBeenCalled();
  });

  it('answers 429 when verified traffic is over its budget', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 7,
    });
    const event = await emitSucceeded();
    const { rawBody, signature } = fake.signWebhook(event);
    const response = await POST(post(rawBody, {}, signature));

    expect(response.status).toBe(429);
    expect(consumeRateLimit).toHaveBeenCalledWith(
      'payment_webhook',
      'provider',
    );
    expect(recordProviderEvent).not.toHaveBeenCalled();
  });

  it('refuses a genuine event the table could not hold', async () => {
    const event = await emitSucceeded();
    const { rawBody, signature } = fake.signBody(
      JSON.stringify({ ...event, occurredAt: '0500-01-01T00:00:00.000Z' }),
    );
    const response = await POST(post(rawBody, {}, signature));

    expect(response.status).toBe(400);
    expect(recordProviderEvent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('payment webhook refused', {
      kind: 'event_not_storable',
    });
  });

  it('lets a provider fault surface instead of calling it a bad signature', async () => {
    vi.spyOn(fake, 'verifyWebhook').mockRejectedValue(
      new PaymentsError('provider_unavailable'),
    );

    await expect(POST(post('{}', {}, 'x'))).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    expect(recordProviderEvent).not.toHaveBeenCalled();
  });
});
