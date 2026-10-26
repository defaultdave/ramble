import { createHmac } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { DeliveryEvent } from '@/lib/email/message';
import { server } from '../../../../tests/msw/server';
import { EmailProviderError, WebhookPayloadError } from './errors';
import { createFakeAdapter } from './fake';
import { createPostmarkAdapter } from './postmark';
import { createResendAdapter } from './resend';
import type { EmailAdapter, OutboundEmail } from './types';

// The contract every adapter meets. Nothing here reaches a network: MSW answers the two HTTP
// providers with the shapes their documentation shows, and refuses any request without a handler.
//
// Behaviours under test, one per decision, branch, or risk:
// - send returns the provider's message ID and carries the recipient, subject, both bodies, and reply-to
// - send authenticates with the provider credential, and Resend also forwards the idempotency key
// - a 4xx refusal is not retryable; 429, 5xx, and a dropped connection are
// - a 200 with no message ID, with a non-JSON body, over 64 KB, or (Postmark) with an error code is not retryable
// - only the start of a long refusal reaches the error message
// - the failure message names the status and never the credential
// - a webhook is verified only with the right secret; wrong, missing, and wrong-scheme credentials fail
// - Resend webhooks also fail on a tampered body, a stale or future timestamp, and a wrong signature version,
//   and pass when one of several listed signatures is right
// - delivered, hard bounce, and complaint events parse to a normalized event
// - a transient bounce and an unrelated event are ignored; a body that is not that provider's event throws

const webhookKey = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const resendSecret = `whsec_${Buffer.from(webhookKey).toString('base64')}`;
const wrongResendSecret = `whsec_${Buffer.from('y'.repeat(32)).toString('base64')}`;
const plainSecret = 'test-webhook-secret-xxxxxxxxxxxxxxxxxxxxxxxx';
const wrongPlainSecret = 'wrong-webhook-secret-yyyyyyyyyyyyyyyyyyyyyyyy';
const now = 1_790_000_000;

const email: OutboundEmail = {
  from: 'Ramble <hello@example.com>',
  replyTo: 'support@example.com',
  to: 'guest@example.com',
  subject: 'Your booking',
  html: '<p>See you soon</p>',
  text: 'See you soon',
  idempotencyKey: 'order-7:confirmation',
};

function svixHeaders(
  body: string,
  options: {
    secret?: string;
    timestamp?: number;
    id?: string;
    version?: string;
    extraSignature?: string;
  } = {},
): Headers {
  const id = options.id ?? 'msg_1';
  const timestamp = String(options.timestamp ?? now);
  const key = Buffer.from(
    (options.secret ?? resendSecret).replace('whsec_', ''),
    'base64',
  );
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  const listed = `${options.version ?? 'v1'},${signature}`;
  return new Headers({
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': options.extraSignature
      ? `${options.extraSignature} ${listed}`
      : listed,
  });
}

type Kind = 'delivered' | 'hard_bounce' | 'complaint';

type WebhookCase = {
  name: string;
  adapter: EmailAdapter;
  authorize: (body: string, secretIsWrong?: boolean) => Headers;
  wrongScheme: Headers;
  body: (kind: Kind | 'soft_bounce' | 'other', messageId: string) => string;
  malformed: string[];
};

const webhookCases: WebhookCase[] = [
  {
    name: 'fake',
    adapter: createFakeAdapter(plainSecret),
    authorize: (_body, wrong = false) =>
      new Headers({
        authorization: `Bearer ${wrong ? wrongPlainSecret : plainSecret}`,
      }),
    wrongScheme: new Headers({ authorization: `Basic ${btoa(plainSecret)}` }),
    body: (kind, messageId) =>
      JSON.stringify({
        messageId,
        event: kind === 'soft_bounce' || kind === 'other' ? 'opened' : kind,
      }),
    malformed: ['not json', '{}', '{"messageId":"m","event":"opened"}'],
  },
  {
    name: 'resend',
    adapter: createResendAdapter({
      apiKey: 're_live_key',
      webhookSecret: resendSecret,
    }),
    authorize: (body, wrong = false) =>
      svixHeaders(body, { secret: wrong ? wrongResendSecret : resendSecret }),
    wrongScheme: new Headers({ authorization: `Bearer ${resendSecret}` }),
    body: (kind, messageId) => {
      const type = {
        delivered: 'email.delivered',
        hard_bounce: 'email.bounced',
        complaint: 'email.complained',
        soft_bounce: 'email.bounced',
        other: 'email.opened',
      }[kind];
      return JSON.stringify({
        type,
        created_at: '2026-10-26T12:00:00Z',
        data: {
          email_id: messageId,
          to: ['guest@example.com'],
          ...(type === 'email.bounced'
            ? {
                bounce: {
                  type: kind === 'soft_bounce' ? 'Transient' : 'Permanent',
                },
              }
            : {}),
        },
      });
    },
    malformed: [
      'not json',
      '{}',
      '{"type":"email.delivered"}',
      '{"type":"email.delivered","data":{}}',
    ],
  },
  {
    name: 'postmark',
    adapter: createPostmarkAdapter({
      serverToken: 'pm-server-token',
      webhookSecret: plainSecret,
    }),
    authorize: (_body, wrong = false) =>
      new Headers({
        authorization: `Basic ${btoa(`ramble:${wrong ? wrongPlainSecret : plainSecret}`)}`,
      }),
    wrongScheme: new Headers({ authorization: `Bearer ${plainSecret}` }),
    body: (kind, messageId) => {
      const record = {
        delivered: { RecordType: 'Delivery' },
        hard_bounce: { RecordType: 'Bounce', Type: 'HardBounce' },
        complaint: { RecordType: 'SpamComplaint' },
        soft_bounce: { RecordType: 'Bounce', Type: 'Transient' },
        other: { RecordType: 'Open' },
      }[kind];
      return JSON.stringify({
        ...record,
        MessageID: messageId,
        Recipient: 'guest@example.com',
      });
    },
    malformed: [
      'not json',
      '{}',
      '{"RecordType":"Delivery"}',
      '{"RecordType":"Bounce","Type":"HardBounce"}',
    ],
  },
];

describe.each(webhookCases)('$name webhook', (c) => {
  const request = (headers: Headers, body = c.body('delivered', 'm-1')) => ({
    headers,
    rawBody: body,
    nowSeconds: now,
  });

  it('is verified with the right secret', () => {
    const body = c.body('delivered', 'm-1');

    expect(c.adapter.verifyWebhook(request(c.authorize(body), body))).toBe(
      true,
    );
  });

  it('is refused with the wrong secret', () => {
    const body = c.body('delivered', 'm-1');

    expect(
      c.adapter.verifyWebhook(request(c.authorize(body, true), body)),
    ).toBe(false);
  });

  it('is refused with no credentials', () => {
    expect(c.adapter.verifyWebhook(request(new Headers()))).toBe(false);
  });

  it('is refused with the right secret in another scheme', () => {
    expect(c.adapter.verifyWebhook(request(c.wrongScheme))).toBe(false);
  });

  it.each<[Kind, DeliveryEvent['kind']]>([
    ['delivered', 'delivered'],
    ['hard_bounce', 'hard_bounce'],
    ['complaint', 'complaint'],
  ])('parses a %s event', (kind, expected) => {
    expect(c.adapter.parseWebhook(c.body(kind, 'm-9'))).toEqual({
      providerMessageId: 'm-9',
      kind: expected,
    });
  });

  it.each(c.malformed)('throws for the body %j', (body) => {
    expect(() => c.adapter.parseWebhook(body)).toThrow(WebhookPayloadError);
  });

  it('refuses a message ID over 200 characters', () => {
    expect(() =>
      c.adapter.parseWebhook(c.body('delivered', 'x'.repeat(201))),
    ).toThrow(WebhookPayloadError);
  });
});

// The fake adapter's own format has no events beyond the three, so anything else is malformed there.
describe.each(webhookCases.filter(({ name }) => name !== 'fake'))(
  '$name ignored events',
  (c) => {
    it.each(['soft_bounce', 'other'] as const)('ignores a %s event', (kind) => {
      expect(c.adapter.parseWebhook(c.body(kind, 'm-9'))).toBeNull();
    });
  },
);

describe('resend webhook signature', () => {
  const adapter = createResendAdapter({
    apiKey: 're_live_key',
    webhookSecret: resendSecret,
  });
  const body = '{"type":"email.delivered","data":{"email_id":"m-1"}}';
  const verify = (headers: Headers, rawBody = body) =>
    adapter.verifyWebhook({ headers, rawBody, nowSeconds: now });

  it('fails when the body changed after signing', () => {
    expect(verify(svixHeaders(body), `${body} `)).toBe(false);
  });

  it('fails when the message ID header changed', () => {
    const headers = svixHeaders(body);
    headers.set('svix-id', 'msg_2');

    expect(verify(headers)).toBe(false);
  });

  it.each([
    ['5 minutes old', now - 300, true],
    ['over 5 minutes old', now - 301, false],
    ['5 minutes ahead', now + 300, true],
    ['over 5 minutes ahead', now + 301, false],
  ])('judges a timestamp that is %s', (_label, timestamp, accepted) => {
    expect(verify(svixHeaders(body, { timestamp }))).toBe(accepted);
  });

  it('fails on a timestamp that is not whole seconds', () => {
    const headers = svixHeaders(body);
    headers.set('svix-timestamp', '1.79e9');

    expect(verify(headers)).toBe(false);
  });

  it('fails on a signature version it does not know', () => {
    expect(verify(svixHeaders(body, { version: 'v2' }))).toBe(false);
  });

  it('passes when one of several listed signatures is right', () => {
    expect(verify(svixHeaders(body, { extraSignature: 'v1,AAAA' }))).toBe(true);
  });

  it('fails on an oversize signature header', () => {
    const headers = svixHeaders(body);
    headers.set('svix-signature', `v1,${'A'.repeat(1001)}`);

    expect(verify(headers)).toBe(false);
  });
});

describe('fake adapter send', () => {
  it('returns a fresh message ID and sends nothing', async () => {
    const adapter = createFakeAdapter(undefined);

    const [first, second] = await Promise.all([
      adapter.send(email),
      adapter.send(email),
    ]);

    expect(first.providerMessageId).toMatch(/^fake-/);
    expect(second.providerMessageId).not.toBe(first.providerMessageId);
  });

  it('refuses every webhook while no secret is set', () => {
    const adapter = createFakeAdapter(undefined);

    expect(
      adapter.verifyWebhook({
        headers: new Headers({ authorization: 'Bearer undefined' }),
        rawBody: '',
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});

type SendCase = {
  name: 'resend' | 'postmark';
  adapter: EmailAdapter;
  url: string;
  credentialHeader: [string, string];
  ok: () => Response;
  okId: string;
  withoutId: () => Response;
};

const sendCases: SendCase[] = [
  {
    name: 'resend',
    adapter: createResendAdapter({
      apiKey: 're_live_key',
      webhookSecret: resendSecret,
    }),
    url: 'https://api.resend.com/emails',
    credentialHeader: ['authorization', 'Bearer re_live_key'],
    ok: () => HttpResponse.json({ id: 're_msg_123' }),
    okId: 're_msg_123',
    withoutId: () => HttpResponse.json({}),
  },
  {
    name: 'postmark',
    adapter: createPostmarkAdapter({
      serverToken: 'pm-server-token',
      webhookSecret: plainSecret,
    }),
    url: 'https://api.postmarkapp.com/email',
    credentialHeader: ['x-postmark-server-token', 'pm-server-token'],
    ok: () =>
      HttpResponse.json({
        MessageID: 'pm-msg-123',
        ErrorCode: 0,
        Message: 'OK',
      }),
    okId: 'pm-msg-123',
    withoutId: () => HttpResponse.json({ ErrorCode: 0 }),
  },
];

describe.each(sendCases)('$name send', (c) => {
  async function sendCapturing() {
    let captured: { headers: Headers; body: string } | undefined;
    server.use(
      http.post(c.url, async ({ request }) => {
        captured = { headers: request.headers, body: await request.text() };
        return c.ok();
      }),
    );
    const result = await c.adapter.send(email);
    if (!captured) throw new Error('the provider was not called');
    return { result, captured };
  }

  async function failure(respond: () => Response): Promise<EmailProviderError> {
    server.use(http.post(c.url, respond));
    const error = await c.adapter.send(email).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(EmailProviderError);
    return error as EmailProviderError;
  }

  it("returns the provider's message ID", async () => {
    const { result } = await sendCapturing();

    expect(result).toEqual({ providerMessageId: c.okId });
  });

  it('carries the recipient, subject, both bodies, and reply-to', async () => {
    const { captured } = await sendCapturing();

    for (const part of [
      email.to,
      email.subject,
      email.html,
      email.text,
      email.replyTo,
      email.from,
    ]) {
      expect(captured.body).toContain(JSON.stringify(part).slice(1, -1));
    }
  });

  it('authenticates with the provider credential and keeps it out of the body', async () => {
    const { captured } = await sendCapturing();

    const [name, value] = c.credentialHeader;
    expect(captured.headers.get(name)).toBe(value);
    expect(captured.body).not.toContain(value);
  });

  it.each([
    [400, false],
    [401, false],
    [422, false],
    [429, true],
    [500, true],
    [503, true],
  ])('treats a %i response as retryable: %s', async (status, retryable) => {
    const error = await failure(() =>
      HttpResponse.json({ message: 'nope' }, { status }),
    );

    expect(error.retryable).toBe(retryable);
    expect(error.message).toContain(String(status));
    expect(error.message).not.toContain(c.credentialHeader[1]);
  });

  it('treats a dropped connection as retryable', async () => {
    const error = await failure(() => HttpResponse.error());

    expect(error.retryable).toBe(true);
  });

  it('does not retry a 200 with no message ID', async () => {
    const error = await failure(c.withoutId);

    expect(error.retryable).toBe(false);
  });

  it('keeps only the start of a long refusal in the error', async () => {
    const error = await failure(
      () => new HttpResponse('x'.repeat(5000), { status: 422 }),
    );

    expect(error.message.length).toBeLessThan(300);
  });

  it('does not retry a response over 64 KB', async () => {
    const error = await failure(
      () => new HttpResponse(`"${'x'.repeat(64 * 1024)}"`, { status: 200 }),
    );

    expect(error.retryable).toBe(false);
    expect(error.message).toContain('too large');
  });

  it('does not retry a 200 that is not JSON', async () => {
    const error = await failure(() => new HttpResponse('ok', { status: 200 }));

    expect(error.retryable).toBe(false);
  });
});

describe('resend send', () => {
  it('forwards the idempotency key, so a retry cannot deliver twice', async () => {
    let key: string | null = null;
    server.use(
      http.post('https://api.resend.com/emails', ({ request }) => {
        key = request.headers.get('idempotency-key');
        return HttpResponse.json({ id: 're_msg_1' });
      }),
    );

    await createResendAdapter({
      apiKey: 're_live_key',
      webhookSecret: resendSecret,
    }).send(email);

    expect(key).toBe(email.idempotencyKey);
  });
});

describe('postmark send', () => {
  it('does not retry a 200 that carries an error code', async () => {
    server.use(
      http.post('https://api.postmarkapp.com/email', () =>
        HttpResponse.json({
          MessageID: 'pm-msg-9',
          ErrorCode: 406,
          Message: 'Inactive',
        }),
      ),
    );
    const adapter = createPostmarkAdapter({
      serverToken: 'pm-server-token',
      webhookSecret: plainSecret,
    });

    const error = await adapter.send(email).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailProviderError);
    expect((error as EmailProviderError).retryable).toBe(false);
  });
});
