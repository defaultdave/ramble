import { beforeEach, describe, expect, it, vi } from 'vitest';
import { anonymousCaller, Role, type Caller } from '@/server/auth/caller';
import { recordAudit } from '@/server/db/audit';
import { findMailboxMessage, listMailboxSummaries } from '@/server/db/messages';
import { mailboxSecret, setEnv } from '../../../../tests/email/testEnv';
import { loadMailbox, loadMailboxMessage, unlockMailbox } from './mailbox';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/db/messages', () => ({
  listMailboxSummaries: vi.fn(),
  findMailboxMessage: vi.fn(),
}));
vi.mock('@/server/db/audit', () => ({ recordAudit: vi.fn() }));

// Behaviours under test, one per decision, branch, or risk:
// Access, for the list and the detail, in every combination of who and where:
// - the ops role opens it with no cookie and no secret set, in production and in live mode, and is recorded as the ops role
// - a guest or host (no ops role) with the right cookie opens it off production, recorded as the secret
// - production refuses the secret path even with the right cookie, and a signed-in non-ops user gets the same answer as an anonymous one
// - no role and no cookie, a wrong cookie, an empty cookie, and the raw secret as the cookie are locked; nothing is read or recorded
// - with no secret set, or in live mode, a non-ops caller is disabled
// - admin without the ops role is not let in
// - the cookie stops working when the secret changes
// Reads:
// - the list is recorded before it is read; a failed audit write returns nothing
// - a detail is read for a UUID and recorded with its id; a malformed or unknown id is missing and records nothing
// Unlocking:
// - the right secret off production gives a cookie value that is not the secret and is recorded once
// - a wrong or empty secret, production, live mode, and no secret give nothing and record nothing

const id = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const userId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const summary = {
  id,
  recipient: 'guest@example.com',
  template: 'dev-check',
  subject: 'Ramble email check',
  status: 'captured' as const,
  createdAt: new Date('2026-10-26T12:00:00Z'),
};
const message = { ...summary, html: '<p>Hi</p>', textBody: 'Hi' };

const ops: Caller = { userId, roles: [Role.Ops], hostIds: [] };
const guest: Caller = { userId, roles: [Role.Guest], hostIds: [] };
const host: Caller = { userId, roles: [Role.HostOwner], hostIds: ['h1'] };
const admin: Caller = { userId, roles: [Role.Admin], hostIds: [] };

/** The cookie value a tester gets for the secret, with the audit mock cleared of the unlock's own row. */
async function issueCookie(secret: string): Promise<string> {
  setEnv(testEnv, { DEV_MAILBOX_SECRET: secret });
  const token = await unlockMailbox(anonymousCaller, secret);
  if (token === null) throw new Error('the secret did not unlock the mailbox');
  vi.mocked(recordAudit).mockClear();
  return token;
}

beforeEach(() => {
  setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret });
  vi.mocked(listMailboxSummaries).mockReset().mockResolvedValue([summary]);
  vi.mocked(findMailboxMessage).mockReset().mockResolvedValue(message);
  vi.mocked(recordAudit).mockReset().mockResolvedValue();
});

describe('the ops role', () => {
  it.each([
    ['no secret is set', { DEV_MAILBOX_SECRET: undefined }],
    ['on production', { VERCEL_ENV: 'production' }],
    ['in live mode', { EMAIL_MODE: 'live' }],
  ])(
    'opens the list and the detail with no cookie when %s',
    async (_l, env) => {
      setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret, ...env });

      expect(await loadMailbox(ops, undefined)).toEqual({
        status: 'open',
        messages: [summary],
      });
      expect(await loadMailboxMessage(ops, undefined, id)).toEqual({
        status: 'open',
        message,
      });
      expect(recordAudit).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          actorKind: 'user',
          actorId: userId,
          action: 'mailbox.listed',
          details: { via: 'ops_role' },
        }),
      );
      expect(recordAudit).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          action: 'mailbox.message_read',
          subjectId: id,
          details: { via: 'ops_role' },
        }),
      );
    },
  );

  it('is recorded as the ops role even when it also holds the secret cookie', async () => {
    const cookie = await issueCookie(mailboxSecret);

    await loadMailbox({ ...ops, roles: [Role.Guest, Role.Ops] }, cookie);

    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ details: { via: 'ops_role' } }),
    );
  });
});

describe('the shared secret off production', () => {
  it.each([
    ['a signed-in guest', guest, 'user'],
    ['a signed-in host', host, 'user'],
    ['an anonymous visitor', anonymousCaller, 'guest'],
  ])('opens the list and detail for %s', async (_l, caller, actorKind) => {
    const cookie = await issueCookie(mailboxSecret);

    expect((await loadMailbox(caller, cookie)).status).toBe('open');
    expect((await loadMailboxMessage(caller, cookie, id)).status).toBe('open');
    expect(recordAudit).toHaveBeenCalledTimes(2);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorKind, details: { via: 'secret' } }),
    );
  });

  it('works on a preview deployment', async () => {
    const cookie = await issueCookie(mailboxSecret);
    setEnv(testEnv, {
      DEV_MAILBOX_SECRET: mailboxSecret,
      VERCEL_ENV: 'preview',
    });

    expect((await loadMailbox(guest, cookie)).status).toBe('open');
  });
});

describe('refused callers', () => {
  it.each([
    ['a guest', guest],
    ['a host', host],
    ['an admin without the ops role', admin],
    ['nobody signed in', anonymousCaller],
  ])(
    'on production the secret is refused for %s, even with the right cookie',
    async (_l, caller) => {
      const cookie = await issueCookie(mailboxSecret);
      setEnv(testEnv, {
        DEV_MAILBOX_SECRET: mailboxSecret,
        VERCEL_ENV: 'production',
      });

      expect(await loadMailbox(caller, cookie)).toEqual({ status: 'disabled' });
      expect(await loadMailboxMessage(caller, cookie, id)).toEqual({
        status: 'disabled',
      });
      expect(listMailboxSummaries).not.toHaveBeenCalled();
      expect(findMailboxMessage).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['no cookie', undefined],
    ['a wrong cookie', 'f'.repeat(64)],
    ['an empty cookie', ''],
    ['the raw secret as the cookie', mailboxSecret],
  ])('locks a guest with %s and records nothing', async (_label, cookie) => {
    expect(await loadMailbox(guest, cookie)).toEqual({ status: 'locked' });
    expect(await loadMailboxMessage(guest, cookie, id)).toEqual({
      status: 'locked',
    });
    expect(listMailboxSummaries).not.toHaveBeenCalled();
    expect(findMailboxMessage).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('refuses a cookie issued under an earlier secret', async () => {
    const old = await issueCookie(mailboxSecret);
    setEnv(testEnv, { DEV_MAILBOX_SECRET: `${mailboxSecret}-rotated` });

    expect(await loadMailbox(guest, old)).toEqual({ status: 'locked' });
  });

  it.each([
    ['no secret is set', { DEV_MAILBOX_SECRET: undefined }],
    ['the mode is live', { EMAIL_MODE: 'live' }],
  ])('disables a guest when %s', async (_label, override) => {
    const cookie = await issueCookie(mailboxSecret);
    setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret, ...override });

    expect(await loadMailbox(guest, cookie)).toEqual({ status: 'disabled' });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('reading', () => {
  it('records the list before it is read and returns nothing if the record fails', async () => {
    vi.mocked(recordAudit).mockRejectedValue(new Error('audit down'));

    await expect(loadMailbox(ops, undefined)).rejects.toThrow('audit down');
    expect(listMailboxSummaries).not.toHaveBeenCalled();
  });

  it('returns no message if recording its read fails', async () => {
    vi.mocked(recordAudit).mockRejectedValue(new Error('audit down'));

    await expect(loadMailboxMessage(ops, undefined, id)).rejects.toThrow(
      'audit down',
    );
  });

  it.each(['not-a-uuid', '', '5b3d7ad4', `${id}; DROP TABLE messages`])(
    'treats the malformed ID %j as missing without a query or a record',
    async (bad) => {
      expect(await loadMailboxMessage(ops, undefined, bad)).toEqual({
        status: 'missing',
      });
      expect(findMailboxMessage).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it('treats an unknown ID as missing and records nothing', async () => {
    vi.mocked(findMailboxMessage).mockResolvedValue(null);

    expect(await loadMailboxMessage(ops, undefined, id)).toEqual({
      status: 'missing',
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('unlockMailbox', () => {
  it('gives a cookie value for the right secret, not the secret itself, and records it once', async () => {
    const cookie = await unlockMailbox(guest, mailboxSecret);

    expect(cookie).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie).not.toContain(mailboxSecret);
    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        actorKind: 'user',
        actorId: userId,
        action: 'mailbox.unlocked',
      }),
    );
  });

  it.each([
    ['a wrong secret', `${mailboxSecret}x`, {}],
    ['an empty secret', '', {}],
    ['production', mailboxSecret, { VERCEL_ENV: 'production' }],
    ['live mode', mailboxSecret, { EMAIL_MODE: 'live' }],
    ['no secret set', mailboxSecret, { DEV_MAILBOX_SECRET: undefined }],
  ])('gives nothing and records nothing for %s', async (_l, submitted, env) => {
    setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret, ...env });

    expect(await unlockMailbox(guest, submitted)).toBeNull();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('does not let the ops role open the secret path on production', async () => {
    setEnv(testEnv, {
      DEV_MAILBOX_SECRET: mailboxSecret,
      VERCEL_ENV: 'production',
    });

    expect(await unlockMailbox(ops, mailboxSecret)).toBeNull();
  });
});
