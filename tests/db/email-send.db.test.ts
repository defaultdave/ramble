import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { emailSuppressions, messages } from '@/server/db/schema';
import {
  client,
  email,
  errors,
  live,
  log,
  request,
  resendAccepts,
  resendRefuses,
  resendSettings,
  rowFor,
  rowsFor,
  setMode,
  setupEmailDatabase,
} from './emailFixtures';

vi.mock('@/server/env', async () => ({
  env: (await import('./emailFixtures')).testEnv,
}));

// Behaviours under test, one per decision, branch, or risk:
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

setupEmailDatabase();

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
