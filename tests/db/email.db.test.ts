import { createHmac, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { http, HttpResponse } from 'msw';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { emailAddressPattern } from '@/lib/email/address';
import { emailSuppressions, messages } from '@/server/db/schema';
import { server } from '../msw/server';
import { mailboxSecret, setEnv, webhookSecret } from '../email/testEnv';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));

// Behaviours under test, one per decision, branch, or risk:
// sending
// - sink mode logs a captured message with its bodies and a fake provider ID, with the recipient lower-cased
// - a malformed request is refused with no row written
// - the same key sends once: a repeat returns the first message and the provider is called once
// - the same key for another recipient is a conflict, not a second send
// - two sends racing on one key reach the provider once and leave one row
// - a suppressed address is logged as suppressed and not sent, and a repeat of that key stays suppressed
// - allowlist mode sends listed recipients through the provider (no body kept) and keeps the rest in the mailbox
// - live mode sends through the provider and the dev mailbox shows nothing
// - a provider failure is logged as failed with a reason, thrown, and a retry under the same key can succeed
// - the sixth attempt is refused without a provider call
// - a fresh queued message is left alone, and one a crashed sender abandoned is claimed
// - a retry after the settings changed is refused with no attempt used and nothing sent, and a settled message stays settled
// - recording a send, a failure, or a suppression that matches no row throws
// - an adapter that cannot be built (no key) fails before any row is written
// delivery webhook
// - delivered moves a sent message to delivered
// - a hard bounce and a complaint move it and suppress the address, and the next send to it is suppressed
// - a late delivered does not undo a bounce, and a replayed bounce leaves one suppression
// - an event for a message Ramble never sent changes nothing
// - a signed Resend bounce suppresses, and a transient one does not
// dev mailbox reads
// - they list only captured messages, newest first, capped at 100, and the detail returns the bodies
// - a message sent through a real provider is not in the mailbox
// rate limiting
// - 20 failed verifications from one address are 401 and the 21st is 429 with Retry-After, while other addresses and verified requests still pass
// - the 601st verified request in a minute is 429, and failed verifications do not use that cap
// database constraints
// - each CHECK, the enums, both unique constraints, and the suppression foreign key refuse a bad row
// - the address pattern means the same in JavaScript and in Postgres

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let email: typeof import('@/server/ports/email');
let webhook: typeof import('@/server/ports/email/webhook');
let errors: typeof import('@/server/ports/email/errors');
let log: typeof import('@/server/db/messages');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  setEnv(testEnv, { DATABASE_URL: fresh.url });
  client = await import('@/server/db/client');
  email = await import('@/server/ports/email');
  webhook = await import('@/server/ports/email/webhook');
  errors = await import('@/server/ports/email/errors');
  log = await import('@/server/db/messages');
  server.listen({ onUnhandledFrame: 'bypass' });
});

afterAll(async () => {
  server.close();
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const signingSecret = `whsec_${Buffer.from('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx').toString('base64')}`;
const resendSettings = {
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 're_key',
  EMAIL_FROM: 'Ramble <hello@ramble.example>',
  EMAIL_REPLY_TO: 'support@ramble.example',
  EMAIL_WEBHOOK_SECRET: signingSecret,
};

const live = { ...resendSettings, EMAIL_MODE: 'live' };

function setMode(overrides: Record<string, unknown> = {}) {
  setEnv(testEnv, { DATABASE_URL: fresh.url, ...overrides });
}

beforeEach(() => {
  setMode({ EMAIL_WEBHOOK_SECRET: webhookSecret });
});

afterEach(() => {
  server.resetHandlers();
});

let counter = 0;
function request(
  overrides: Partial<
    Parameters<typeof import('@/server/ports/email').sendEmail>[0]
  > = {},
) {
  counter += 1;
  return {
    template: 'dev-check' as const,
    to: `guest${String(counter)}@example.com`,
    data: { recipientName: 'Sam' },
    idempotencyKey: `key-${String(counter)}`,
    ...overrides,
  };
}

async function rowFor(idempotencyKey: string) {
  const [row] = await client.db
    .select()
    .from(messages)
    .where(eq(messages.idempotencyKey, idempotencyKey));
  if (!row) throw new Error(`no message with key ${idempotencyKey}`);
  return row;
}

async function rowsFor(idempotencyKey: string) {
  return client.db
    .select()
    .from(messages)
    .where(eq(messages.idempotencyKey, idempotencyKey));
}

function resendAccepts() {
  const calls: { key: string | null; body: string }[] = [];
  server.use(
    http.post('https://api.resend.com/emails', async ({ request: sent }) => {
      calls.push({
        key: sent.headers.get('idempotency-key'),
        body: await sent.text(),
      });
      return HttpResponse.json({ id: `re_${randomUUID()}` });
    }),
  );
  return calls;
}

function resendRefuses(status: number) {
  const calls: number[] = [];
  server.use(
    http.post('https://api.resend.com/emails', () => {
      calls.push(status);
      return HttpResponse.json({ message: 'refused' }, { status });
    }),
  );
  return calls;
}

function post(body: string, headers: Record<string, string>) {
  return webhook.deliveryWebhookResponse(
    new Request('http://localhost/api/webhooks/email', {
      method: 'POST',
      body,
      headers,
    }),
    Math.floor(Date.now() / 1000),
  );
}

const fakeEvent = (providerMessageId: string, event: string) =>
  post(JSON.stringify({ messageId: providerMessageId, event }), {
    authorization: `Bearer ${webhookSecret}`,
  });

describe('sending in sink mode', () => {
  it('logs a captured message with its bodies and lower-cases the recipient', async () => {
    const input = request({
      to: 'Guest@Example.COM',
      idempotencyKey: 'sink-1',
    });

    const result = await email.sendEmail(input);

    expect(result).toMatchObject({ status: 'captured', deduplicated: false });
    const row = await rowFor('sink-1');
    expect(row).toMatchObject({
      id: result.messageId,
      recipient: 'guest@example.com',
      template: 'dev-check',
      subject: 'Ramble email check',
      status: 'captured',
      adapter: 'fake',
      attempts: 1,
      failureReason: null,
    });
    expect(row.providerMessageId).toMatch(/^fake-/);
    expect(row.html).toContain('Hi Sam');
    expect(row.html).toContain('http://localhost:3000/help');
    expect(row.textBody).toContain('Hi Sam');
  });

  it.each([
    ['a bad address', { to: 'guest' }],
    [
      'a header-injecting address',
      { to: 'a@example.com\r\nBcc: b@example.com' },
    ],
    ['an unknown template', { template: 'surprise' }],
    ['bad data', { data: { recipientName: '' } }],
    ['a key with a space', { idempotencyKey: 'two words' }],
    ['a key over 200 characters', { idempotencyKey: 'k'.repeat(201) }],
  ])('refuses %s and writes no row', async (_label, override) => {
    const before = await client.db.$count(messages);

    await expect(
      email.sendEmail({ ...request(), ...override } as never),
    ).rejects.toThrow();

    expect(await client.db.$count(messages)).toBe(before);
  });

  it('sends once per key: a repeat returns the first message', async () => {
    const input = request();
    const first = await email.sendEmail(input);
    const providerId = (await rowFor(input.idempotencyKey)).providerMessageId;

    const second = await email.sendEmail(input);

    expect(second).toEqual({
      messageId: first.messageId,
      status: 'captured',
      deduplicated: true,
    });
    expect(await rowsFor(input.idempotencyKey)).toHaveLength(1);
    expect((await rowFor(input.idempotencyKey)).providerMessageId).toBe(
      providerId,
    );
  });

  it('treats the same key for another recipient as a conflict', async () => {
    const input = request();
    await email.sendEmail(input);

    await expect(
      email.sendEmail({ ...input, to: 'someone.else@example.com' }),
    ).rejects.toThrow(errors.IdempotencyConflictError);
    expect(await rowsFor(input.idempotencyKey)).toHaveLength(1);
  });

  it('sends once when two calls race on one key', async () => {
    setMode(live);
    const calls = resendAccepts();
    const input = request();

    const results = await Promise.all([
      email.sendEmail(input),
      email.sendEmail(input),
    ]);

    expect(calls).toHaveLength(1);
    expect(await rowsFor(input.idempotencyKey)).toHaveLength(1);
    expect(results.filter(({ deduplicated }) => !deduplicated)).toHaveLength(1);
  });
});

describe('suppression', () => {
  async function suppress(address: string) {
    await client.db
      .insert(emailSuppressions)
      .values({ address, reason: 'hard_bounce' });
  }

  it('logs a suppressed address as suppressed and does not send', async () => {
    const input = request({ to: 'gone@example.com' });
    await suppress('gone@example.com');

    const result = await email.sendEmail({ ...input, to: 'GONE@example.com' });

    expect(result).toMatchObject({ status: 'suppressed', deduplicated: false });
    expect(await rowFor(input.idempotencyKey)).toMatchObject({
      status: 'suppressed',
      providerMessageId: null,
      html: null,
      attempts: 0,
    });
    expect(
      await email.sendEmail({ ...input, to: 'gone@example.com' }),
    ).toMatchObject({
      status: 'suppressed',
      deduplicated: true,
    });
  });

  it('suppresses a failed message whose address was closed before the retry', async () => {
    setMode(live);
    const input = request({ to: 'later@example.com' });
    resendRefuses(503);
    await expect(email.sendEmail(input)).rejects.toThrow();
    await suppress('later@example.com');
    const calls = resendRefuses(503);

    const result = await email.sendEmail(input);

    expect(result.status).toBe('suppressed');
    expect(calls).toHaveLength(0);
    expect(await rowFor(input.idempotencyKey)).toMatchObject({
      status: 'suppressed',
      failureReason: null,
    });
  });
});

describe('sending through a provider', () => {
  it('in live mode sends through the provider and keeps no body', async () => {
    setMode(live);
    const calls = resendAccepts();
    const input = request();

    const result = await email.sendEmail(input);

    expect(result.status).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.key).toBe(input.idempotencyKey);
    expect(calls[0]?.body).toContain('Hi Sam');
    expect(await rowFor(input.idempotencyKey)).toMatchObject({
      status: 'sent',
      adapter: 'resend',
      html: null,
      textBody: null,
    });
    expect(await log.listMailboxSummaries()).not.toContainEqual(
      expect.objectContaining({ id: result.messageId }),
    );
  });

  it('in allowlist mode sends listed recipients out and keeps the rest in the mailbox', async () => {
    setMode({
      ...resendSettings,
      EMAIL_MODE: 'allowlist',
      EMAIL_ALLOWLIST: ['staff@example.com'],
    });
    const calls = resendAccepts();
    const listed = request({ to: 'staff@example.com' });
    const unlisted = request({ to: 'guest.unlisted@example.com' });

    const [out, kept] = await Promise.all([
      email.sendEmail(listed),
      email.sendEmail(unlisted),
    ]);

    expect(out.status).toBe('sent');
    expect(kept.status).toBe('captured');
    expect(calls).toHaveLength(1);
    expect(await rowFor(unlisted.idempotencyKey)).toMatchObject({
      adapter: 'fake',
    });
  });

  it('logs a provider failure, throws it, and lets a retry under the same key succeed', async () => {
    setMode(live);
    const input = request();
    resendRefuses(503);

    await expect(email.sendEmail(input)).rejects.toMatchObject({
      name: 'EmailProviderError',
      retryable: true,
    });
    const failed = await rowFor(input.idempotencyKey);
    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 1,
      providerMessageId: null,
    });
    expect(failed.failureReason).toContain('503');

    resendAccepts();
    const retried = await email.sendEmail(input);

    expect(retried).toMatchObject({ status: 'sent', deduplicated: false });
    expect(await rowFor(input.idempotencyKey)).toMatchObject({
      status: 'sent',
      attempts: 2,
      failureReason: null,
    });
  });

  it('refuses a sixth attempt without calling the provider', async () => {
    setMode(live);
    const input = request();
    const calls = resendRefuses(500);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(email.sendEmail(input)).rejects.toThrow();
    }
    await expect(email.sendEmail(input)).rejects.toThrow(
      errors.SendAttemptsExhaustedError,
    );

    expect(calls).toHaveLength(5);
    expect(await rowFor(input.idempotencyKey)).toMatchObject({
      status: 'failed',
      attempts: 5,
    });
  });

  it('leaves a fresh queued message alone and claims one a crashed sender abandoned', async () => {
    setMode(live);
    const input = request();
    const queued = await log.insertMessage(
      {
        idempotencyKey: input.idempotencyKey,
        template: input.template,
        recipient: input.to,
        subject: 'Ramble email check',
        adapter: 'resend',
      },
      'attempt',
    );
    const calls = resendAccepts();

    const whileFresh = await email.sendEmail(input);
    await client.db.execute(
      sql`UPDATE messages SET updated_at = now() - interval '11 minutes' WHERE id = ${queued?.id}`,
    );
    const afterCrash = await email.sendEmail(input);

    expect(whileFresh).toMatchObject({ status: 'queued', deduplicated: true });
    expect(afterCrash).toMatchObject({ status: 'sent', deduplicated: false });
    expect(calls).toHaveLength(1);
    expect((await rowFor(input.idempotencyKey)).attempts).toBe(2);
  });

  it('refuses a retry after the settings changed, using up no attempt and sending nothing', async () => {
    setMode(live);
    const input = request();
    resendRefuses(503);
    await expect(email.sendEmail(input)).rejects.toThrow();
    const calls = resendAccepts();

    setMode({ EMAIL_MODE: 'sink' });
    await expect(email.sendEmail(input)).rejects.toThrow(
      errors.AdapterChangedError,
    );
    setMode({
      ...live,
      EMAIL_PROVIDER: 'postmark',
      POSTMARK_SERVER_TOKEN: 'pm',
    });
    await expect(email.sendEmail(input)).rejects.toThrow(
      errors.AdapterChangedError,
    );

    expect(calls).toHaveLength(0);
    expect(await rowFor(input.idempotencyKey)).toMatchObject({
      status: 'failed',
      attempts: 1,
      adapter: 'resend',
      html: null,
    });
  });

  it('settles a sent message whatever the settings are now', async () => {
    const input = request();
    await email.sendEmail(input);
    setMode(live);

    expect(await email.sendEmail(input)).toMatchObject({
      status: 'captured',
      deduplicated: true,
    });
  });

  it('fails before writing a row when the provider is not configured', async () => {
    setMode({ EMAIL_PROVIDER: 'resend', EMAIL_MODE: 'live' });
    const input = request();

    await expect(email.sendEmail(input)).rejects.toThrow('RESEND_API_KEY');

    expect(await rowsFor(input.idempotencyKey)).toHaveLength(0);
  });
});

describe('writes that match no row', () => {
  it('throw, so a lost write is never mistaken for a recorded one', async () => {
    const { messageId } = await email.sendEmail(request());

    await expect(
      log.recordSent(messageId, { status: 'sent', providerMessageId: 'x' }),
    ).rejects.toThrow('expected 1');
    await expect(log.recordFailed(messageId, 'late')).rejects.toThrow(
      'expected 1',
    );
    await expect(log.recordSuppressed(messageId)).rejects.toThrow('expected 1');
    await expect(log.recordFailed(randomUUID(), 'gone')).rejects.toThrow(
      'expected 1',
    );
  });
});

describe('the delivery webhook', () => {
  async function capture() {
    const input = request();
    await email.sendEmail(input);
    const row = await rowFor(input.idempotencyKey);
    return { input, row, providerId: row.providerMessageId ?? '' };
  }

  const suppressionsFor = (address: string) =>
    client.db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.address, address));

  it('moves a message to delivered', async () => {
    const { input, providerId } = await capture();

    expect((await fakeEvent(providerId, 'delivered')).status).toBe(200);

    expect((await rowFor(input.idempotencyKey)).status).toBe('delivered');
    expect(await suppressionsFor(input.to)).toEqual([]);
  });

  it.each([
    ['hard_bounce', 'bounced'],
    ['complaint', 'complained'],
  ])(
    'moves a message on a %s to %s and suppresses the address',
    async (event, status) => {
      const { input, row, providerId } = await capture();

      expect((await fakeEvent(providerId, event)).status).toBe(200);

      expect((await rowFor(input.idempotencyKey)).status).toBe(status);
      expect(await suppressionsFor(input.to)).toMatchObject([
        { reason: event, sourceMessageId: row.id },
      ]);
      const next = await email.sendEmail(request({ to: input.to }));
      expect(next.status).toBe('suppressed');
    },
  );

  it('keeps a bounce when a delivered arrives late, and a replayed bounce adds no second suppression', async () => {
    const { input, providerId } = await capture();

    await fakeEvent(providerId, 'hard_bounce');
    await fakeEvent(providerId, 'delivered');
    await fakeEvent(providerId, 'hard_bounce');

    expect((await rowFor(input.idempotencyKey)).status).toBe('bounced');
    expect(await suppressionsFor(input.to)).toHaveLength(1);
  });

  it('changes nothing for a message Ramble never sent', async () => {
    const before = await client.db.$count(emailSuppressions);

    const result = await fakeEvent('fake-unknown', 'hard_bounce');

    expect(result.status).toBe(200);
    expect(await client.db.$count(emailSuppressions)).toBe(before);
  });

  it('acts on a signed Resend bounce when permanent, and not when transient', async () => {
    setMode(live);
    resendAccepts();
    const permanent = request();
    const transient = request();
    await email.sendEmail(permanent);
    await email.sendEmail(transient);
    const permanentId = (await rowFor(permanent.idempotencyKey))
      .providerMessageId;
    const transientId = (await rowFor(transient.idempotencyKey))
      .providerMessageId;

    const signed = (emailId: string, bounceType: string) => {
      const body = JSON.stringify({
        type: 'email.bounced',
        data: { email_id: emailId, bounce: { type: bounceType } },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac(
        'sha256',
        Buffer.from(signingSecret.replace('whsec_', ''), 'base64'),
      )
        .update(`msg_1.${timestamp}.${body}`)
        .digest('base64');
      return post(body, {
        'svix-id': 'msg_1',
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      });
    };

    expect((await signed(permanentId ?? '', 'Permanent')).status).toBe(200);
    expect((await signed(transientId ?? '', 'Transient')).status).toBe(200);

    expect((await rowFor(permanent.idempotencyKey)).status).toBe('bounced');
    expect((await rowFor(transient.idempotencyKey)).status).toBe('sent');
    expect(await suppressionsFor(permanent.to)).toHaveLength(1);
    expect(await suppressionsFor(transient.to)).toHaveLength(0);
  });
});

describe('dev mailbox reads', () => {
  it('lists captured messages newest first and returns the bodies of one', async () => {
    const older = request({ data: { recipientName: 'Older' } });
    const newer = request({ data: { recipientName: 'Newer' } });
    await email.sendEmail(older);
    await email.sendEmail(newer);

    const list = await log.listMailboxSummaries();
    const olderAt = list.findIndex(({ recipient }) => recipient === older.to);
    const newerAt = list.findIndex(({ recipient }) => recipient === newer.to);

    expect(newerAt).toBeGreaterThanOrEqual(0);
    expect(newerAt).toBeLessThan(olderAt);
    const detail = await log.findMailboxMessage(list[newerAt]?.id ?? '');
    expect(detail?.html).toContain('Hi Newer');
    expect(detail?.textBody).toContain('Hi Newer');
  });

  it('returns nothing for an unknown ID or a message that was sent for real', async () => {
    setMode(live);
    resendAccepts();
    const { messageId } = await email.sendEmail(request());

    expect(await log.findMailboxMessage(messageId)).toBeNull();
    expect(await log.findMailboxMessage(randomUUID())).toBeNull();
  });

  it('shows at most one page of 100', async () => {
    await client.db.execute(sql`
      INSERT INTO messages (idempotency_key, template, recipient, subject, status, adapter, provider_message_id, html, text_body, attempts)
      SELECT 'bulk-' || n, 'dev-check', 'bulk' || n || '@example.com', 'Bulk', 'captured', 'fake', 'fake-bulk-' || n, '<p>x</p>', 'x', 1
      FROM generate_series(1, 120) AS n`);

    expect(await log.listMailboxSummaries()).toHaveLength(100);
  });
});

describe('database constraints', () => {
  const valid = {
    idempotencyKey: 'valid-row',
    template: 'dev-check',
    recipient: 'guest@example.com',
    subject: 'Hello',
    status: 'queued' as const,
    adapter: 'fake' as const,
    attempts: 1,
  };
  const body = { html: '<p>x</p>', textBody: 'x' };
  const captured = { status: 'captured' as const, providerMessageId: 'fake-1' };

  let nth = 0;
  function insert(overrides: Record<string, unknown>) {
    nth += 1;
    return client.db.insert(messages).values({
      ...valid,
      idempotencyKey: `constraint-${String(nth)}`,
      ...overrides,
    } as typeof messages.$inferInsert);
  }

  it('accepts the baseline rows the cases below change one thing in', async () => {
    await insert({});
    await insert({ ...captured, ...body });
  });

  it.each<[string, string, Record<string, unknown>]>([
    [
      'an upper-case recipient',
      'messages_recipient_shape',
      { recipient: 'Guest@example.com' },
    ],
    [
      'a recipient with no dot in the domain',
      'messages_recipient_shape',
      { recipient: 'guest@localhost' },
    ],
    [
      'a recipient with a line break',
      'messages_recipient_shape',
      { recipient: 'a@example.com\nb@example.com' },
    ],
    [
      'a recipient over 254 characters',
      'messages_recipient_shape',
      { recipient: `${'a'.repeat(250)}@example.com` },
    ],
    [
      'a key with a space',
      'messages_idempotency_key_shape',
      { idempotencyKey: 'two words' },
    ],
    [
      'a key of 201 characters',
      'messages_idempotency_key_shape',
      { idempotencyKey: 'k'.repeat(201) },
    ],
    ['an empty key', 'messages_idempotency_key_shape', { idempotencyKey: '' }],
    [
      'a template with a space',
      'messages_template_shape',
      { template: 'dev check' },
    ],
    [
      'a template of 65 characters',
      'messages_template_shape',
      { template: 'a'.repeat(65) },
    ],
    [
      'a subject with a line break',
      'messages_subject_shape',
      { subject: 'Hi\nBcc: x@example.com' },
    ],
    ['an empty subject', 'messages_subject_shape', { subject: '' }],
    [
      'a subject of 201 characters',
      'messages_subject_shape',
      { subject: 'a'.repeat(201) },
    ],
    [
      'a provider ID on a queued message',
      'messages_provider_message_id_follows_status',
      { providerMessageId: 'x' },
    ],
    [
      'no provider ID on a sent message',
      'messages_provider_message_id_follows_status',
      { status: 'sent' },
    ],
    [
      'a provider ID of 201 characters',
      'messages_provider_message_id_length',
      { ...captured, providerMessageId: 'p'.repeat(201) },
    ],
    [
      'a body on a real adapter',
      'messages_body_only_for_fake_adapter',
      { adapter: 'resend', status: 'sent', providerMessageId: 'r', ...body },
    ],
    [
      'html without text',
      'messages_body_is_both_or_neither',
      { ...captured, html: '<p>x</p>' },
    ],
    [
      'an empty body',
      'messages_body_length',
      { ...captured, html: '', textBody: '' },
    ],
    [
      'a body over 300000 characters',
      'messages_body_length',
      { ...captured, html: 'a'.repeat(300_001), textBody: 'x' },
    ],
    [
      'a created_at of infinity',
      'messages_created_at_in_range',
      { createdAt: sql`'infinity'::timestamptz` },
    ],
    ['six attempts', 'messages_attempts_capped', { attempts: 6 }],
    ['negative attempts', 'messages_attempts_capped', { attempts: -1 }],
    [
      'a failed message with no reason',
      'messages_failure_reason_iff_failed',
      { status: 'failed' },
    ],
    [
      'a reason on a queued message',
      'messages_failure_reason_iff_failed',
      { failureReason: 'because' },
    ],
    [
      'an empty reason',
      'messages_failure_reason_iff_failed',
      { status: 'failed', failureReason: '' },
    ],
    [
      'a reason over 500 characters',
      'messages_failure_reason_iff_failed',
      { status: 'failed', failureReason: 'r'.repeat(501) },
    ],
  ])('refuses %s', async (_label, constraint, overrides) => {
    await expect(insert(overrides)).rejects.toMatchObject({
      cause: { constraint },
    });
  });

  it('refuses a status that is not in the enum', async () => {
    await expect(insert({ status: 'nope' })).rejects.toMatchObject({
      cause: { code: '22P02' },
    });
  });

  it('refuses a repeated idempotency key', async () => {
    await insert({ idempotencyKey: 'dupe' });

    await expect(insert({ idempotencyKey: 'dupe' })).rejects.toMatchObject({
      cause: { code: '23505' },
    });
  });

  it('refuses a repeated provider ID for one adapter and allows it across adapters', async () => {
    await insert({ ...captured, providerMessageId: 'same-id' });

    await expect(
      insert({ ...captured, providerMessageId: 'same-id' }),
    ).rejects.toMatchObject({
      cause: { constraint: 'messages_provider_message_id_unique' },
    });
    await insert({
      adapter: 'resend',
      status: 'sent',
      providerMessageId: 'same-id',
    });
  });

  it.each([
    ['an upper-case address', 'Gone@example.com'],
    ['an address with a space', 'go ne@example.com'],
    ['an address with no domain dot', 'gone@localhost'],
    ['an address over 254 characters', `${'a'.repeat(250)}@example.com`],
  ])('refuses a suppression for %s', async (_label, address) => {
    await expect(
      client.db
        .insert(emailSuppressions)
        .values({ address, reason: 'complaint' }),
    ).rejects.toMatchObject({
      cause: { constraint: 'email_suppressions_address_shape' },
    });
  });

  it('refuses a suppression reason outside the enum, and a repeated address', async () => {
    await expect(
      client.db
        .insert(emailSuppressions)
        .values({ address: 'a@example.com', reason: 'nope' as never }),
    ).rejects.toMatchObject({ cause: { code: '22P02' } });
    await client.db
      .insert(emailSuppressions)
      .values({ address: 'twice@example.com', reason: 'complaint' });
    await expect(
      client.db
        .insert(emailSuppressions)
        .values({ address: 'twice@example.com', reason: 'hard_bounce' }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('keeps a suppression when its source message is deleted', async () => {
    const [message] = await insert({}).returning();
    await client.db.insert(emailSuppressions).values({
      address: 'kept@example.com',
      reason: 'complaint',
      sourceMessageId: message?.id ?? '',
    });

    await client.db.delete(messages).where(eq(messages.id, message?.id ?? ''));

    const [suppression] = await client.db
      .select()
      .from(emailSuppressions)
      .where(eq(emailSuppressions.address, 'kept@example.com'));
    expect(suppression?.sourceMessageId).toBeNull();
  });

  it.each([
    ['guest@example.com', true],
    ['a.b+tag@sub.example.co.uk', true],
    ['Guest@example.com', false],
    ['guest@localhost', false],
    ['a@-example.com', false],
    ['a@example-.com', false],
    ['a@example..com', false],
    ['gu est@example.com', false],
    ['a@example.com\nb@example.com', false],
    ['gü@example.com', false],
  ])(
    'reads %j as an address: %s, the same in JavaScript and Postgres',
    async (address, expected) => {
      const { rows } = await client.db.execute<{ ok: boolean }>(
        sql`SELECT ${address} ~ ${emailAddressPattern} AS ok`,
      );

      expect(rows[0]?.ok).toBe(expected);
      expect(new RegExp(emailAddressPattern).test(address)).toBe(expected);
    },
  );
});

describe('the dev mailbox gate over the real log', () => {
  it('shows a captured message to the secret holder and nobody else', async () => {
    setMode({ DEV_MAILBOX_SECRET: mailboxSecret });
    const mailbox = await import('@/server/ports/email/mailbox');
    const { messageId } = await email.sendEmail(request());
    const cookie = mailbox.unlockMailbox(mailboxSecret) ?? '';

    const open = await mailbox.loadMailboxMessage(cookie, messageId);
    const locked = await mailbox.loadMailboxMessage(undefined, messageId);

    expect(open).toMatchObject({ status: 'open', message: { id: messageId } });
    expect(locked).toEqual({ status: 'locked' });
  });
});

describe('webhook rate limiting with the real limiter', () => {
  // Earlier webhook tests in this file have already spent tries in the shared window.
  beforeAll(async () => {
    await client.db.execute(sql`DELETE FROM rate_limits`);
  });

  const bad = (address: string) => post('{}', { 'x-forwarded-for': address });

  it('answers 401 to 20 failed verifications from one address and 429 to the next, without touching other addresses or verified traffic', async () => {
    for (let n = 0; n < 20; n += 1) {
      expect((await bad('203.0.113.9')).status).toBe(401);
    }
    const refused = await bad('203.0.113.9');

    expect(refused.status).toBe(429);
    const retry = Number(refused.headers.get('retry-after'));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(600);
    expect((await bad('203.0.113.10')).status).toBe(401);
    const verified = await fakeEvent('fake-unknown', 'delivered');
    expect(verified.status).toBe(200);
  });

  it('refuses the 601st verified request in a minute and counts only verified ones against that cap', async () => {
    await client.db.execute(sql`DELETE FROM rate_limits`);

    for (let n = 0; n < 600; n += 1) {
      expect((await fakeEvent('fake-unknown', 'delivered')).status).toBe(200);
    }
    const refused = await fakeEvent('fake-unknown', 'delivered');

    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect((await bad('198.51.100.1')).status).toBe(401);
  });
});
