import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FORM_TOKEN_FIELD,
  HONEYPOT_FIELD,
  MAX_FORM_AGE_MS,
  MIN_FILL_MS,
} from '@/lib/formGuard';

async function load() {
  vi.resetModules();
  return import('./formGuard');
}

const issuedAt = new Date('2026-11-01T12:00:00Z');
const after = (ms: number) => new Date(issuedAt.getTime() + ms);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('checkFormGuard', () => {
  it('passes a genuine token after the minimum fill time', async () => {
    const { issueFormGuardToken, checkFormGuard } = await load();
    const token = issueFormGuardToken(issuedAt);

    expect(
      checkFormGuard({ [FORM_TOKEN_FIELD]: token }, after(MIN_FILL_MS)),
    ).toEqual({ ok: true });
  });

  it.each([
    ['too fast', 0, undefined, 'too_fast'],
    ['expired', MAX_FORM_AGE_MS + 1, undefined, 'expired'],
    ['a filled honeypot', 10_000, 'spam', 'honeypot_filled'],
  ] as const)('refuses %s', async (_name, elapsed, honeypot, reason) => {
    const { issueFormGuardToken, checkFormGuard } = await load();
    const token = issueFormGuardToken(issuedAt);

    expect(
      checkFormGuard(
        {
          [FORM_TOKEN_FIELD]: token,
          ...(honeypot ? { [HONEYPOT_FIELD]: honeypot } : {}),
        },
        after(elapsed),
      ),
    ).toEqual({ ok: false, reason });
  });

  it('refuses a token whose time was back-dated to skip the wait', async () => {
    const { issueFormGuardToken, checkFormGuard } = await load();
    const [, signature] = issueFormGuardToken(issuedAt).split('.');
    const backdated = `${String(issuedAt.getTime() - 60_000)}.${String(signature)}`;

    expect(checkFormGuard({ [FORM_TOKEN_FIELD]: backdated }, issuedAt)).toEqual(
      { ok: false, reason: 'invalid_token' },
    );
  });

  it('refuses the same signature spelled non-canonically', async () => {
    const { issueFormGuardToken, checkFormGuard } = await load();
    const token = issueFormGuardToken(issuedAt);
    // The last of 43 characters carries 2 unused bits, which a lenient decoder ignores.
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = alphabet[alphabet.indexOf(token.slice(-1)) ^ 1];
    const variants = [
      `${token.slice(0, -1)}${String(sibling)}`,
      `${token}\n`,
      `${token} `,
      `${token}=`,
    ];

    for (const variant of variants) {
      expect(
        checkFormGuard({ [FORM_TOKEN_FIELD]: variant }, after(10_000)),
      ).toEqual({ ok: false, reason: 'invalid_token' });
    }
    expect(
      checkFormGuard({ [FORM_TOKEN_FIELD]: token }, after(10_000)),
    ).toEqual({ ok: true });
  });

  it('refuses a token signed with another secret', async () => {
    vi.stubEnv('FORM_GUARD_SECRET', 'a'.repeat(40));
    const issuer = await load();
    const token = issuer.issueFormGuardToken(issuedAt);
    vi.stubEnv('FORM_GUARD_SECRET', 'b'.repeat(40));
    const checker = await load();

    expect(
      checker.checkFormGuard({ [FORM_TOKEN_FIELD]: token }, after(10_000)),
    ).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it.each([
    ['no token', {}],
    ['an empty token', { [FORM_TOKEN_FIELD]: '' }],
    ['a token that is not a string', { [FORM_TOKEN_FIELD]: 7 }],
    ['not an object', 'token'],
    ['no signature', { [FORM_TOKEN_FIELD]: '1793534400000' }],
    ['an empty signature', { [FORM_TOKEN_FIELD]: '1793534400000.' }],
    ['a non-numeric time', { [FORM_TOKEN_FIELD]: 'soon.AAAA' }],
    ['a signed-looking extra part', { [FORM_TOKEN_FIELD]: '1.2.3' }],
    ['an oversized token', { [FORM_TOKEN_FIELD]: 'x'.repeat(5000) }],
  ])('refuses %s', async (_name, fields) => {
    const { checkFormGuard } = await load();

    expect(checkFormGuard(fields, after(10_000))).toEqual({
      ok: false,
      reason: 'invalid_token',
    });
  });
});

describe('the signing secret', () => {
  it('is a fixed development value outside production', async () => {
    vi.stubEnv('FORM_GUARD_SECRET', undefined);
    const { issueFormGuardToken } = await load();

    expect(() => issueFormGuardToken(issuedAt)).not.toThrow();
  });

  it('is required in production, for issuing and for checking', async () => {
    vi.stubEnv('FORM_GUARD_SECRET', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    const { issueFormGuardToken, checkFormGuard } = await load();

    expect(() => issueFormGuardToken(issuedAt)).toThrow(
      'FORM_GUARD_SECRET is not set',
    );
    expect(() =>
      checkFormGuard({ [FORM_TOKEN_FIELD]: `1.${'A'.repeat(43)}` }, issuedAt),
    ).toThrow('FORM_GUARD_SECRET is not set');
  });
});
