import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findMailboxMessage, listMailboxSummaries } from '@/server/db/messages';
import { mailboxSecret, setEnv } from '../../../../tests/email/testEnv';
import { loadMailbox, loadMailboxMessage, unlockMailbox } from './mailbox';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/db/messages', () => ({
  listMailboxSummaries: vi.fn(),
  findMailboxMessage: vi.fn(),
}));

// Behaviours under test, one per decision, branch, or risk:
// - with no DEV_MAILBOX_SECRET the mailbox is disabled, for the list, the detail, and unlocking
// - in live mode it is disabled even when the secret is set, since real mail is flowing
// - a wrong or oversize secret does not unlock; the right one gives a cookie value that is not the secret
// - with no cookie, a wrong cookie, or the raw secret as the cookie, the list and detail are locked and read nothing
// - with the unlock cookie the list is read, and a detail is read when the ID is a UUID
// - a malformed ID is missing without a query, and an unknown ID is missing
// - the cookie stops working when the secret changes

const id = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const summary = {
  id,
  recipient: 'guest@example.com',
  template: 'dev-check',
  subject: 'Ramble email check',
  status: 'captured' as const,
  createdAt: new Date('2026-10-26T12:00:00Z'),
};
const message = { ...summary, html: '<p>Hi</p>', textBody: 'Hi' };

function cookieFor(secret: string): string {
  const cookie = unlockMailbox(secret);
  if (cookie === null) throw new Error('the secret did not unlock the mailbox');
  return cookie;
}

beforeEach(() => {
  setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret });
  vi.mocked(listMailboxSummaries).mockReset().mockResolvedValue([summary]);
  vi.mocked(findMailboxMessage).mockReset().mockResolvedValue(message);
});

describe('a disabled mailbox', () => {
  it.each([
    ['no secret is set', { DEV_MAILBOX_SECRET: undefined }],
    ['the mode is live', { EMAIL_MODE: 'live' }],
  ])('is disabled when %s', async (_label, override) => {
    const cookie = cookieFor(mailboxSecret);
    setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret, ...override });

    expect(unlockMailbox(mailboxSecret)).toBeNull();
    expect(await loadMailbox(cookie)).toEqual({ status: 'disabled' });
    expect(await loadMailboxMessage(cookie, id)).toEqual({
      status: 'disabled',
    });
    expect(listMailboxSummaries).not.toHaveBeenCalled();
    expect(findMailboxMessage).not.toHaveBeenCalled();
  });
});

describe('unlockMailbox', () => {
  it('gives a cookie value for the right secret, and the value is not the secret', () => {
    const cookie = cookieFor(mailboxSecret);

    expect(cookie).not.toContain(mailboxSecret);
    expect(cookie).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['a wrong secret', `${mailboxSecret}x`],
    ['an empty secret', ''],
    ['an oversize secret', 'x'.repeat(257)],
  ])('gives nothing for %s', (_label, submitted) => {
    expect(unlockMailbox(submitted)).toBeNull();
  });
});

describe('a locked mailbox', () => {
  it.each([
    ['no cookie', undefined],
    ['a wrong cookie', 'f'.repeat(64)],
    ['an empty cookie', ''],
    ['the raw secret as the cookie', mailboxSecret],
  ])('refuses the list and the detail with %s', async (_label, cookie) => {
    expect(await loadMailbox(cookie)).toEqual({ status: 'locked' });
    expect(await loadMailboxMessage(cookie, id)).toEqual({ status: 'locked' });
    expect(listMailboxSummaries).not.toHaveBeenCalled();
    expect(findMailboxMessage).not.toHaveBeenCalled();
  });

  it('refuses a cookie issued under an earlier secret', async () => {
    const old = cookieFor(mailboxSecret);
    setEnv(testEnv, { DEV_MAILBOX_SECRET: `${mailboxSecret}-rotated` });

    expect(await loadMailbox(old)).toEqual({ status: 'locked' });
  });
});

describe('an open mailbox', () => {
  it('lists the messages', async () => {
    expect(await loadMailbox(cookieFor(mailboxSecret))).toEqual({
      status: 'open',
      messages: [summary],
    });
  });

  it('reads one message by ID', async () => {
    expect(await loadMailboxMessage(cookieFor(mailboxSecret), id)).toEqual({
      status: 'open',
      message,
    });
    expect(findMailboxMessage).toHaveBeenCalledWith(id);
  });

  it.each(['not-a-uuid', '', '5b3d7ad4', `${id}; DROP TABLE messages`])(
    'treats the malformed ID %j as missing without a query',
    async (bad) => {
      expect(await loadMailboxMessage(cookieFor(mailboxSecret), bad)).toEqual({
        status: 'missing',
      });
      expect(findMailboxMessage).not.toHaveBeenCalled();
    },
  );

  it('treats an unknown ID as missing', async () => {
    vi.mocked(findMailboxMessage).mockResolvedValue(null);

    expect(await loadMailboxMessage(cookieFor(mailboxSecret), id)).toEqual({
      status: 'missing',
    });
  });
});
