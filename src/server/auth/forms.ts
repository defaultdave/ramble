import 'server-only';
import {
  ConfirmSignInSchema,
  isOwnOrigin,
  endSessionStatus,
  safeNextPath,
  signInFailureUrl,
  verifyErrorCallbackPath,
  verifyOutcome,
} from '@/lib/signIn';
import { readBodyText } from '@/server/boundedBody';
import { env } from '@/server/env';
import { logger } from '@/server/monitoring/logger';
import { handleAuthRequest } from './handler';

// The two plain form posts the sign-in pages make. Each turns a form into the Better Auth request
// it stands for, then sends the browser on with a 303 so the next request is a GET.

const maxFormBytes = 2048;
const noStore = { 'Cache-Control': 'no-store' } as const;

/** The site's own origin, for an address that goes in an email or a redirect. */
export const appOrigin = () => new URL(env.APP_URL).origin;

/** A cross-site post is refused, so another site cannot sign a visitor in to its own account or out of theirs. */
function refuseForeignOrigin(request: Request): Response | null {
  return isOwnOrigin(
    request.headers.get('origin'),
    appOrigin(),
    request.headers.get('sec-fetch-site'),
  )
    ? null
    : new Response(null, { status: 403, headers: noStore });
}

function redirectTo(location: string, from?: Headers): Response {
  const headers = new Headers(from);
  headers.set('Location', location);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 303, headers });
}

function signInFailure(next: string): Response {
  return redirectTo(signInFailureUrl(appOrigin(), next));
}

/**
 * The confirm page's button. Only this post asks Better Auth to use the link, so a request that
 * merely opens the page, as a mail scanner's does, leaves it unused. Better Auth sets the session
 * cookie and answers with where to go; a link it refuses lands back on /sign-in with the error.
 */
export async function handleConfirmSignIn(request: Request): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const { text, exceeded } = await readBodyText(request, maxFormBytes);
  const form = new URLSearchParams(exceeded ? '' : text);
  const next = safeNextPath(form.get('next'));
  const parsed = ConfirmSignInSchema.safeParse({
    token: form.get('token') ?? '',
    next,
  });
  if (!parsed.success) return signInFailure(next);

  const verify = new URL('/api/auth/magic-link/verify', appOrigin());
  verify.searchParams.set('token', parsed.data.token);
  verify.searchParams.set('callbackURL', next);
  verify.searchParams.set('errorCallbackURL', verifyErrorCallbackPath(next));

  const response = await handleAuthRequest(
    new Request(verify, {
      headers: { 'user-agent': request.headers.get('user-agent') ?? '' },
    }),
  );
  const outcome = verifyOutcome(
    response.status,
    response.headers.get('location'),
  );
  if (outcome.kind === 'refused') {
    if (outcome.unexpectedStatus !== null) {
      logger.error('Better Auth answered a sign-in link unexpectedly', {
        status: outcome.unexpectedStatus,
      });
    }
    return signInFailure(next);
  }
  return redirectTo(outcome.location, response.headers);
}

/** The header's Sign out button: ends the session Better Auth finds from the cookie and goes home. */
export async function handleEndSession(request: Request): Promise<Response> {
  const foreign = refuseForeignOrigin(request);
  if (foreign) return foreign;

  const origin = appOrigin();
  const response = await handleAuthRequest(
    new Request(new URL('/api/auth/sign-out', origin), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        cookie: request.headers.get('cookie') ?? '',
      },
      body: '{}',
    }),
  );
  if (endSessionStatus(response.ok) === 502) {
    return new Response(null, { status: 502, headers: noStore });
  }
  return redirectTo('/', response.headers);
}
