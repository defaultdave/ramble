import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { mailboxSecret } from '../email/testEnv';
import {
  client,
  email,
  live,
  log,
  request,
  resendAccepts,
  setMode,
  setupEmailDatabase,
} from './emailFixtures';

vi.mock('@/server/env', async () => ({
  env: (await import('./emailFixtures')).testEnv,
}));

// Behaviours under test, one per decision, branch, or risk:
// - the dev mailbox lists only captured messages, newest first, capped at 100, and the detail returns the bodies
// - a message sent through a real provider is not in the mailbox
// - the mailbox gate shows a captured message to the secret holder and nobody else

setupEmailDatabase();

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
