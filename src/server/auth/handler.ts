import 'server-only';
import {
  isSignInLinkRequest,
  maxSignInBodyBytes,
  SignInLinkRequestSchema,
} from '@/lib/auth';
import { clientAddress } from '@/lib/clientAddress';
import { declaredLengthExceeds } from '@/lib/email/message';
import { readBodyText } from '@/server/boundedBody';
import { logger } from '@/server/monitoring/logger';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { errorKind } from '@/lib/errorKind';
import { safeNextPath } from '@/lib/signIn';
import { getAuth } from './auth';
import { onScreenSignInLink } from './onScreenLink';
import { noStore, refusal } from './refusal';

function withoutContentLength(headers: Headers): Headers {
  const copy = new Headers(headers);
  copy.delete('content-length');
  return copy;
}

/** The client's count, or `undefined` while it allows the request, so the address's count is next. */
async function consumeClientLimit(request: Request) {
  const decision = await consumeRateLimit(
    'sign_in_link_client',
    clientAddress(request.headers.get('x-forwarded-for')),
  );
  return decision.allowed ? undefined : decision;
}

/**
 * Counts a sign-in link request against its client and then its address before Better Auth sees it. Returns the request
 * to pass on (its body was read, so it is rebuilt from the text) or the refusal. A request that
 * cannot be read, or a counter that cannot be reached, is refused: nothing is sent without being
 * counted.
 */
async function guardSignInLink(
  request: Request,
): Promise<
  { request: Request; email: string; next: string } | { refusal: Response }
> {
  if (
    declaredLengthExceeds(
      request.headers.get('content-length'),
      maxSignInBodyBytes,
    )
  ) {
    return { refusal: refusal(413) };
  }
  const { text, exceeded } = await readBodyText(request, maxSignInBodyBytes);
  if (exceeded) return { refusal: refusal(413) };

  let parsed: ReturnType<typeof SignInLinkRequestSchema.safeParse>;
  try {
    parsed = SignInLinkRequestSchema.safeParse(JSON.parse(text));
  } catch {
    return { refusal: refusal(400) };
  }
  if (!parsed.success) return { refusal: refusal(400) };

  try {
    // The client first: a request it refuses must not spend the address's count, or one client
    // could still lock a guest out by being refused.
    const decision =
      (await consumeClientLimit(request)) ??
      (await consumeRateLimit('sign_in_link', parsed.data.email));
    if (!decision.allowed) {
      return {
        refusal: refusal(429, {
          'Retry-After': String(decision.retryAfterSeconds),
        }),
      };
    }
  } catch (error) {
    logger.error('The sign-in link counter failed', {
      errorName: errorKind(error),
    });
    return { refusal: refusal(503) };
  }
  return {
    email: parsed.data.email,
    next: safeNextPath(parsed.data.callbackURL),
    request: new Request(request.url, {
      method: request.method,
      // The declared length was the original body's; the rebuilt one sets its own.
      headers: withoutContentLength(request.headers),
      body: text,
    }),
  };
}

/**
 * Every request under /api/auth: the sign-in link request first goes through its rate limit; the
 * rest, including the link's verify address (GET /api/auth/magic-link/verify), go to Better Auth.
 * Nothing here is cached, because a response may set or clear the session cookie.
 *
 * Next passes a route's second argument to it, so a request from outside can never turn on the
 * on-screen link: it has its own function, `handleSignInFormRequest`, which only the form's action calls.
 */
export function handleAuthRequest(request: Request): Promise<Response> {
  return handle(request, false);
}

/**
 * The sign-in form's request, in this process. As `handleAuthRequest`, except that when the link is
 * to be shown on the page (src/server/auth/onScreenLink.ts) the answer is `{ status: true,
 * signInPath }` and no email goes through Better Auth.
 */
export function handleSignInFormRequest(request: Request): Promise<Response> {
  return handle(request, true);
}

async function handle(
  request: Request,
  onScreenLink: boolean,
): Promise<Response> {
  let forwarded = request;
  if (isSignInLinkRequest(request.method, new URL(request.url).pathname)) {
    const guarded = await guardSignInLink(request);
    if ('refusal' in guarded) return guarded.refusal;
    forwarded = guarded.request;
    if (onScreenLink) {
      const signInPath = await onScreenSignInLink(guarded.email, guarded.next);
      if (signInPath !== null) {
        return Response.json(
          { status: true, signInPath },
          { headers: noStore },
        );
      }
    }
  }
  const response = await getAuth().handler(forwarded);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
