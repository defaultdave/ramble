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

/** A dot segment is resolved by the browser after the check (`/.//evil.com` becomes `//evil.com`), so none is allowed. */
function hasDotSegment(candidate: string): boolean {
  const path = candidate.split(/[?#]/, 1)[0] ?? '';
  return path.split('/').some((segment) => segment === '.' || segment === '..');
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
    if (!isSitePath(layer) || hasDotSegment(layer)) return '/';
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
  const result = `${parsed.pathname}${parsed.search}`;
  return isSitePath(result) && !hasDotSegment(result) ? result : '/';
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
export function isOwnOrigin(
  origin: string | null,
  appOrigin: string,
  fetchSite: string | null = null,
): boolean {
  if (origin === appOrigin) return true;
  // A browser sends `null` or nothing as Origin on some same-site posts (after a no-referrer
  // page); Sec-Fetch-Site, which a page cannot forge, says the post is from this origin.
  return (origin === null || origin === 'null') && fetchSite === 'same-origin';
}

type ProblemCopy = {
  tone: 'warning' | 'danger';
  title: string;
  body: string;
};

const problemCopy: Record<SignInProblem, ProblemCopy> = {
  link_invalid: {
    tone: 'warning',
    title: 'This sign-in link has expired or was already used',
    body: 'A link works once and lasts 5 minutes. Ask for a new one below.',
  },
  failed: {
    tone: 'danger',
    title: 'We could not sign you in',
    body: 'Something went wrong on our side. Ask for a new link, or try again in a moment.',
  },
};

/** The notice shown for a failed link. */
export function signInProblemCopy(problem: SignInProblem): ProblemCopy {
  return problemCopy[problem];
}

/** The check-your-email notice's text. It does not say whether the address has an account. */
export function signInSentBody(email: string): string {
  return `If ${email} can sign in, a link is on its way. It works once and lasts 5 minutes.`;
}

/** The rate-limited notice's text, naming the wait. */
export function rateLimitBody(retryAfterMinutes: number): string {
  const wait =
    retryAfterMinutes === 1
      ? '1 minute'
      : `${String(retryAfterMinutes)} minutes`;
  return `Try again in about ${wait}. A link you already have still works until it expires.`;
}

/** Where Better Auth sends a refused link: the sign-in page, keeping the destination. */
export function verifyErrorCallbackPath(next: string): string {
  return `${signInPath}?next=${encodeURIComponent(next)}`;
}

/** The address of the sign-in page showing the used-or-expired notice, keeping the destination. */
export function signInFailureUrl(origin: string, next: string): string {
  const url = new URL(verifyErrorCallbackPath(next), origin);
  url.searchParams.set('error', 'INVALID_TOKEN');
  return url.toString();
}

export type VerifyOutcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'refused'; unexpectedStatus: number | null };

/**
 * What Better Auth's answer to a verify request means. A redirect is where to go next (the
 * session cookie or the error page). Anything else is a refusal; a 4xx is an ordinary one, and any
 * other status, or a redirect with no place to go, is reported so it can be logged.
 */
export function verifyOutcome(
  status: number,
  location: string | null,
): VerifyOutcome {
  if (status >= 300 && status < 400 && location !== null) {
    return { kind: 'redirect', location };
  }
  const ordinary = status >= 400 && status < 500;
  return { kind: 'refused', unexpectedStatus: ordinary ? null : status };
}

/** The status of the sign-out post: 303 when Better Auth ended the session, else 502 so the page does not claim it ended. */
export function endSessionStatus(upstreamOk: boolean): 303 | 502 {
  return upstreamOk ? 303 : 502;
}
