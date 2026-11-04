import { isDynamicRoutePath } from './securityHeaders';

// Kept apart from `botCheck.ts` on purpose: the browser loads this file, and importing Zod there
// makes Zod probe `new Function`, which Chromium reports as a CSP violation on every guest page.

/**
 * The paths BotID's client script challenges, with the method it protects. A Server Action is a POST
 * to the page that hosts it, so the booking sheet's reserve is a POST to an experience page. The
 * server side asks `checkBot` in the action itself; this list only tells the browser which requests
 * to sign. Checkout is never on it (ADR 0003, ADR 0007).
 */
export const botProtectedRoutes = [
  { path: '/experiences/*', method: 'POST' },
] as const;

/**
 * BotID's client script loads for every page its init runs on, so init runs only on guest pages.
 * Checkout, gift, manage, and orders carry no third-party tags (ADR 0003, ADR 0007), and host and
 * ops never need the challenge.
 */
export function shouldLoadBotId(pathname: string): boolean {
  return !isDynamicRoutePath(pathname);
}

/**
 * Same rule as `botCheckIsLive` in `botCheck.ts`, kept here because this file is the one the browser
 * may load. `VERCEL` is set on every Vercel build and nowhere else; off Vercel the server check
 * passes everyone, so the challenge script and its rewrite to api.vercel.com have nothing to guard
 * and would only fail on a machine with no route to that host.
 */
export function botChallengeIsLive(vercel: string | undefined): boolean {
  return vercel !== undefined && vercel !== '';
}

/** The build-time value of `botChallengeEnvKey` that tells the browser the challenge is live. */
export const botChallengeEnvKey = 'NEXT_PUBLIC_BOT_CHALLENGE';
