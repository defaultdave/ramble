import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mailboxSecret, setEnv } from '../../../tests/email/testEnv';
import { unlockDevMailbox } from './mailbox';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/db/messages', () => ({}));

const cookieSet = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: cookieSet }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

// Behaviours under test, one per decision or branch:
// - a wrong secret, a missing field, and an oversize field each redirect to the denied page and set no cookie
// - the right secret sets one cookie that is HTTP-only, same-site strict, scoped to the mailbox, and expires in 8 hours
// - the cookie is Secure in production and not in development
// - when the mailbox is disabled even the right secret is denied

function form(secret?: string) {
  const data = new FormData();
  if (secret !== undefined) data.set('secret', secret);
  return data;
}

beforeEach(() => {
  setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret });
  cookieSet.mockReset();
});

describe('unlockDevMailbox', () => {
  it.each([
    ['a wrong secret', form(`${mailboxSecret}x`)],
    ['no secret field', form()],
    ['an oversize secret', form('x'.repeat(257))],
  ])('denies %s and sets no cookie', async (_label, data) => {
    await expect(unlockDevMailbox(data)).rejects.toThrow(
      'redirect:/ops/mailbox?denied=1',
    );
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('sets a scoped, HTTP-only, same-site cookie for the right secret', async () => {
    await expect(unlockDevMailbox(form(mailboxSecret))).rejects.toThrow(
      'redirect:/ops/mailbox',
    );

    expect(cookieSet).toHaveBeenCalledExactlyOnceWith(
      'ramble_dev_mailbox',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      {
        httpOnly: true,
        sameSite: 'strict',
        secure: false,
        path: '/ops/mailbox',
        maxAge: 8 * 60 * 60,
      },
    );
  });

  it('marks the cookie Secure in production', async () => {
    setEnv(testEnv, {
      DEV_MAILBOX_SECRET: mailboxSecret,
      NODE_ENV: 'production',
    });

    await expect(unlockDevMailbox(form(mailboxSecret))).rejects.toThrow();

    expect(cookieSet).toHaveBeenCalledWith(
      'ramble_dev_mailbox',
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );
  });

  it('denies the right secret while the mailbox is disabled', async () => {
    setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret, EMAIL_MODE: 'live' });

    await expect(unlockDevMailbox(form(mailboxSecret))).rejects.toThrow(
      'redirect:/ops/mailbox?denied=1',
    );
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
