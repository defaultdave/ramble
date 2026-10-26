import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mailboxSecret, setEnv } from '../../../tests/email/testEnv';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { unlockDevMailbox } from './mailbox';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/db/messages', () => ({}));
vi.mock('@/server/ports/rate-limit', () => ({ consumeRateLimit: vi.fn() }));

const cookieSet = vi.hoisted(() => vi.fn());
const forwardedFor = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: cookieSet }),
  headers: () =>
    Promise.resolve(
      new Headers(
        forwardedFor.value ? { 'x-forwarded-for': forwardedFor.value } : {},
      ),
    ),
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
// - a wrong attempt is counted against the caller's own address; one over the limit redirects to the limited page
// - a right secret is never counted and never refused, even when the failure counter refuses everyone
// - when the mailbox is disabled even the right secret is denied

function form(secret?: string) {
  const data = new FormData();
  if (secret !== undefined) data.set('secret', secret);
  return data;
}

beforeEach(() => {
  setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret });
  cookieSet.mockReset();
  forwardedFor.value = null;
  vi.mocked(consumeRateLimit)
    .mockReset()
    .mockResolvedValue({ allowed: true, remaining: 1 });
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

  it('counts a wrong attempt against the caller address', async () => {
    forwardedFor.value = '203.0.113.7, 10.0.0.1';

    await expect(unlockDevMailbox(form('wrong'))).rejects.toThrow(
      'redirect:/ops/mailbox?denied=1',
    );

    expect(consumeRateLimit).toHaveBeenCalledExactlyOnceWith(
      'mailbox_unlock_failed',
      '203.0.113.7',
    );
  });

  it('redirects a wrong attempt over the limit to the limited page', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });

    await expect(unlockDevMailbox(form('wrong'))).rejects.toThrow(
      'redirect:/ops/mailbox?limited=1',
    );
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('lets the right secret through without counting it, even when failures are refused', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });

    await expect(unlockDevMailbox(form(mailboxSecret))).rejects.toThrow(
      'redirect:/ops/mailbox',
    );

    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(cookieSet).toHaveBeenCalledOnce();
  });

  it('denies the right secret while the mailbox is disabled', async () => {
    setEnv(testEnv, { DEV_MAILBOX_SECRET: mailboxSecret, EMAIL_MODE: 'live' });

    await expect(unlockDevMailbox(form(mailboxSecret))).rejects.toThrow(
      'redirect:/ops/mailbox?denied=1',
    );
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
