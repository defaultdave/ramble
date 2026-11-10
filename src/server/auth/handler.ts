import 'server-only';
import {
  isSignInLinkRequest,
  maxSignInBodyBytes,
  SignInLinkRequestSchema,
} from '@/lib/auth';
import { declaredLengthExceeds } from '@/lib/email/message';
import { readBodyText } from '@/server/boundedBody';
import { logger } from '@/server/monitoring/logger';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { errorKind } from '@/lib/errorKind';
import { getAuth } from './auth';

const noStore = { 'Cache-Control': 'no-store' } as const;

function refusal(
  status: 400 | 413 | 429 | 503,
  headers: Record<string, string> = {},
) {
  return new Response(null, { status, headers: { ...noStore, ...headers } });
}

/**
 * Counts a sign-in link request against its address before Better Auth sees it. Returns the request
 * to pass on (its body was read, so it is rebuilt from the text) or the refusal. A request that
 * cannot be read, or a counter that cannot be reached, is refused: nothing is sent without being
 * counted.
 */
async function guardSignInLink(
  request: Request,
): Promise<{ request: Request } | { refusal: Response }> {
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
    const decision = await consumeRateLimit('sign_in_link', parsed.data.email);
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
    request: new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: text,
    }),
  };
}

/**
 * Every request under /api/auth: the sign-in link request first goes through its rate limit; the
 * rest, including the link's verify address (GET /api/auth/magic-link/verify), go to Better Auth.
 * Nothing here is cached, because a response may set or clear the session cookie.
 */
export async function handleAuthRequest(request: Request): Promise<Response> {
  let forwarded = request;
  if (isSignInLinkRequest(request.method, new URL(request.url).pathname)) {
    const guarded = await guardSignInLink(request);
    if ('refusal' in guarded) return guarded.refusal;
    forwarded = guarded.request;
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
