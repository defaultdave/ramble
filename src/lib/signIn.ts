import { z } from 'zod';

// The sign-in pages' decisions: where a person may be sent afterwards, what the link in the email
// points at, and which state a refused request or a failed link becomes.

export const signInPath = '/sign-in';
const signInConfirmPath = '/sign-in/confirm';

/** Better Auth's own address for asking for a link. */
export const signInLinkApiPath = '/api/auth/sign-in/magic-link';

/** The form posts the pages make. They sit under /api/auth, so no cached page answers them. */
export const confirmSignInActionPath = '/api/auth/confirm-sign-in';
export const endSessionActionPath = '/api/auth/end-session';

const maxNextChars = 512;
const maxDecodeLayers = 3;
const standInOrigin = 'http://ramble.invalid';

// Control characters and backslashes: a browser drops tabs and newlines inside an address and reads
// a backslash as a slash, so `/\evil.com` and `/\t/evil.com` both end up as `//evil.com`.
const unsafeCharacters = /[\u0000-\u001f\u007f\\]/;

function isSitePath(candidate: string): boolean {
  return (
    candidate.startsWith('/') &&
    !candidate.startsWith('//') &&
    !unsafeCharacters.test(candidate)
  );
}

/**
 * Where to send a person after sign-in: `raw` when it is a path on this site, else `/`. The path
 * and every percent-decoded form of it, up to three layers, must be one (`/%2Fevil.com` and
 * `%2F%2Fevil.com` are refused). What is returned is the parsed path and query, so it is what a
 * browser will read.
 */
export function safeNextPath(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > maxNextChars
  ) {
    return '/';
  }
  let layer = raw;
  for (let depth = 0; ; depth += 1) {
    if (!isSitePath(layer)) return '/';
    let decoded: string;
    try {
      decoded = decodeURIComponent(layer);
    } catch {
      return '/';
    }
    if (decoded === layer) break;
    if (depth === maxDecodeLayers) return '/';
    layer = decoded;
  }
  const parsed = new URL(raw, standInOrigin);
  if (parsed.origin !== standInOrigin) return '/';
  return `${parsed.pathname}${parsed.search}`;
}

/** The sign-in page, asking to land on `next` afterwards unless that is the home page. */
export function signInHref(next: unknown): string {
  const path = safeNextPath(next);
  return path === '/'
    ? signInPath
    : `${signInPath}?next=${encodeURIComponent(path)}`;
}

/** The address in the sign-in email: a Ramble page that asks for a click before it uses the token. */
export function signInConfirmUrl(
  origin: string,
  token: string,
  next: unknown,
): string {
  const url = new URL(signInConfirmPath, origin);
  url.searchParams.set('token', token);
  url.searchParams.set('next', safeNextPath(next));
  return url.toString();
}

/** What the confirm page and its post carry. A Better Auth token is 32 letters and digits. */
export const ConfirmSignInSchema = z.object({
  token: z
    .string()
    .max(128)
    .regex(/^[A-Za-z0-9]+$/),
  next: z.string().max(maxNextChars).optional(),
});

/** What a failed link or an unreadable request shows on /sign-in. */
export type SignInProblem = 'link_invalid' | 'failed';

/**
 * The state for the `error` Better Auth puts on the redirect after a link fails. It reports
 * INVALID_TOKEN for a link that was used, has lapsed, or never existed alike, so the page says all
 * three. No error means no problem.
 */
export function signInProblemFor(
  error: string | undefined,
): SignInProblem | null {
  if (!error) return null;
  return error === 'INVALID_TOKEN' ? 'link_invalid' : 'failed';
}

export type SignInFormState =
  | { status: 'idle' }
  | { status: 'invalid'; email: string }
  | { status: 'sent'; email: string }
  | { status: 'rate_limited'; email: string; retryAfterMinutes: number }
  | { status: 'failed'; email: string };

/** Longest wait the page will name, so a bad header cannot print an absurd number. */
const maxRetryMinutes = 24 * 60;

function retryMinutes(header: string | null): number {
  const seconds =
    header !== null && /^\d{1,7}$/.test(header) ? Number(header) : 0;
  return Math.min(maxRetryMinutes, Math.max(1, Math.ceil(seconds / 60)));
}

/** The form's state after the sign-in request was answered with `status`. 200 sent, 429 counted out, 400 a bad address. */
export function signInStateFor(
  email: string,
  status: number,
  retryAfter: string | null,
): SignInFormState {
  if (status === 200) return { status: 'sent', email };
  if (status === 429) {
    return {
      status: 'rate_limited',
      email,
      retryAfterMinutes: retryMinutes(retryAfter),
    };
  }
  if (status === 400) return { status: 'invalid', email };
  return { status: 'failed', email };
}

/** Whether a post comes from this site: its Origin names the app's own origin. A missing Origin is refused. */
export function isOwnOrigin(origin: string | null, appOrigin: string): boolean {
  return origin !== null && origin === appOrigin;
}
