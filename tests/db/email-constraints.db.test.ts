import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { emailAddressPattern } from '@/lib/email/address';
import { emailSuppressions, messages } from '@/server/db/schema';
import { client, setupEmailDatabase } from './emailFixtures';
import { expectConstraint } from './harness';

vi.mock('@/server/env', async () => ({
  env: (await import('./emailFixtures')).testEnv,
}));

// Behaviours under test, one per decision, branch, or risk:
// - each CHECK, the enums, both unique constraints, and the suppression foreign key refuse a bad row
// - the address pattern means the same in JavaScript and in Postgres

setupEmailDatabase();

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
    await expectConstraint(insert(overrides), constraint);
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

    await expectConstraint(
      insert({ ...captured, providerMessageId: 'same-id' }),
      'messages_provider_message_id_unique',
    );
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
    await expectConstraint(
      client.db
        .insert(emailSuppressions)
        .values({ address, reason: 'complaint' }),
      'email_suppressions_address_shape',
    );
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
