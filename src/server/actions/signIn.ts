'use server';

import { errorKind } from '@/lib/errorKind';
import { SignInLinkRequestSchema } from '@/lib/auth';
import {
  safeNextPath,
  signInLinkApiPath,
  signInStateFor,
  type SignInFormState,
} from '@/lib/signIn';
import { handleAuthRequest } from '@/server/auth/handler';
import { env } from '@/server/env';
import { logger } from '@/server/monitoring/logger';

/**
 * The sign-in form. It asks for a link through the same handler the API address uses, so the
 * `sign_in_link` count applies and a known and an unknown address get the same answer. Nothing
 * here logs the address.
 */
export async function requestSignInLink(
  _previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const typed = formData.get('email');
  const email = typeof typed === 'string' ? typed.trim() : '';
  const parsed = SignInLinkRequestSchema.safeParse({ email });
  if (!parsed.success) return { status: 'invalid', email };

  const origin = new URL(env.APP_URL).origin;
  try {
    const response = await handleAuthRequest(
      new Request(new URL(signInLinkApiPath, origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({
          email: parsed.data.email,
          callbackURL: safeNextPath(formData.get('next')),
        }),
      }),
    );
    return signInStateFor(
      parsed.data.email,
      response.status,
      response.headers.get('retry-after'),
    );
  } catch (error) {
    logger.error('The sign-in link could not be requested', {
      errorName: errorKind(error),
    });
    return { status: 'failed', email };
  }
}
