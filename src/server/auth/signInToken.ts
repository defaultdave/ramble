import 'server-only';
import { createHmac } from 'node:crypto';
import { pickAuthSecret } from '@/lib/auth';
import { env } from '@/server/env';

/**
 * What is stored for a sign-in link's token: HMAC-SHA256 under SIGN_IN_LINK_SECRET, in lower-case
 * hex. The token is 32 random characters, so a plain hash would also hold; the key means a copy of
 * the table alone cannot be checked against guesses.
 */
export function hashSignInToken(token: string): Promise<string> {
  const secret = pickAuthSecret(
    'signInLink',
    env.SIGN_IN_LINK_SECRET,
    env.NODE_ENV,
  );
  if (secret === null) {
    return Promise.reject(new Error('SIGN_IN_LINK_SECRET is not set'));
  }
  return Promise.resolve(
    createHmac('sha256', secret).update(token).digest('hex'),
  );
}
