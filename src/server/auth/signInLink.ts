import 'server-only';
import { randomInt } from 'node:crypto';
import { signInLinkTtlSeconds } from '@/lib/auth';
import { systemClock } from '@/server/ports/clock';
import { getAuth } from './auth';
import { hashSignInToken } from './signInToken';

// Letters only, 32 of them, the shape Better Auth gives its own tokens; the confirm page accepts letters and digits.
const tokenAlphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const tokenLength = 32;

/**
 * Makes a sign-in link's token for an address and stores it the way the magic-link plugin does:
 * the identifier is the keyed hash of the token behind the plugin's prefix, and the value is the
 * record its verify step parses. It lives as long as any sign-in link (ADR 0002). The caller sends
 * the token; the plugin's own request sends the generic sign-in email, which a caller that needs
 * its own wording cannot use.
 */
export async function createSignInLinkToken(email: string): Promise<string> {
  const token = Array.from({ length: tokenLength }, () =>
    tokenAlphabet.charAt(randomInt(tokenAlphabet.length)),
  ).join('');
  const context = await getAuth().$context;
  await context.internalAdapter.createVerificationValue({
    identifier: `magic-link:${await hashSignInToken(token)}`,
    value: JSON.stringify({ type: 'magic-link', email }),
    expiresAt: new Date(
      systemClock.now().getTime() + signInLinkTtlSeconds * 1000,
    ),
  });
  return token;
}
