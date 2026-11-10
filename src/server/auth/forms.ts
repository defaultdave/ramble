import 'server-only';
import {
  ConfirmSignInSchema,
  isOwnOrigin,
  safeNextPath,
  signInPath,
} from '@/lib/signIn';
import { readBodyText } from '@/server/boundedBody';
import { env } from '@/server/env';
import { handleAuthRequest } from './handler';

// The two plain form posts the sign-in pages make. Each turns a form into the Better Auth request
// it stands for, then sends the browser on with a 303 so the next request is a GET.

const maxFormBytes = 2048;
const noStore = { 'Cache-Control': 'no-store' } as const;

const appOrigin = () => new URL(env.APP_URL).origin;

/** A cross-site post is refused, so another site cannot sign a visitor in to its own account or out of theirs. */
function refuseForeignOrigin(request: Request): Response | null {
  return isOwnOrigin(request.headers.get('origin'), appOrigin())
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
  const retry = new URL(signInPath, appOrigin());
  retry.searchParams.set('next', next);
  retry.searchParams.set('error', 'INVALID_TOKEN');
  return redirectTo(retry.toString());
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
  const failed = new URL(signInPath, appOrigin());
  failed.searchParams.set('next', next);
  verify.searchParams.set(
    'errorCallbackURL',
    `${failed.pathname}${failed.search}`,
  );

  const response = await handleAuthRequest(
    new Request(verify, {
      headers: { 'user-agent': request.headers.get('user-agent') ?? '' },
    }),
  );
  const location = response.headers.get('location');
  if (response.status < 300 || response.status >= 400 || location === null) {
    return signInFailure(next);
  }
  return redirectTo(location, response.headers);
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
  if (!response.ok)
    return new Response(null, { status: 502, headers: noStore });
  return redirectTo('/', response.headers);
}
