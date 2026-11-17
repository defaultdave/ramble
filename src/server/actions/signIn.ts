'use server';

import { errorKind } from '@/lib/errorKind';
import { SignInLinkRequestSchema } from '@/lib/auth';
import {
  onScreenLinkHref,
  safeNextPath,
  signInLinkApiPath,
  signInStateFor,
  type SignInFormState,
} from '@/lib/signIn';
import { handleSignInFormRequest } from '@/server/auth/handler';
import { env } from '@/server/env';
import { logger } from '@/server/monitoring/logger';

async function onScreenHrefOf(response: Response): Promise<string | null> {
  if (response.status !== 200) return null;
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && 'signInPath' in body
      ? onScreenLinkHref(body.signInPath)
      : null;
  } catch {
    return null;
  }
}

/**
 * The sign-in form. It asks for a link through the same handler the API address uses, so the
 * `sign_in_link` count applies and a known and an unknown address get the same answer. While email
 * is in sink mode, an address with no role grant gets the link back to show on the page. Nothing
 * here logs the address or the link.
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
    const response = await handleSignInFormRequest(
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
      await onScreenHrefOf(response),
    );
  } catch (error) {
    logger.error('The sign-in link could not be requested', {
      errorName: errorKind(error),
    });
    return { status: 'failed', email };
  }
}
