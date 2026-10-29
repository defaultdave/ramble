import { z } from 'zod';
import { isDynamicRoutePath } from './securityHeaders';

/**
 * Every field is required. `botid` builds `isHuman` as `!body.isBot` whatever the HTTP status was,
 * so a 401, 429, or 5xx body with no `isBot` would otherwise read as a person.
 */
export const BotVerdictSchema = z.object({
  isHuman: z.boolean(),
  isBot: z.boolean(),
  isVerifiedBot: z.boolean(),
});

export type BotVerdict = z.infer<typeof BotVerdictSchema>;

export type BotCheckResult = 'human' | 'bot';

/**
 * Passes only a verdict that says human, not bot, and not a verified bot. A verified crawler is
 * refused too: it has no business holding spaces, signing in, or filing a form. A field that is
 * missing fails closed, because each is compared to the exact value.
 */
export function judgeBotVerdict(
  verdict: Partial<Record<keyof BotVerdict, unknown>>,
): BotCheckResult {
  return verdict.isHuman === true &&
    verdict.isBot === false &&
    verdict.isVerifiedBot === false
    ? 'human'
    : 'bot';
}

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

/** `VERCEL` is set on every Vercel build and runtime and nowhere else, so local runs, tests, and CI skip the lookup. */
export function botCheckIsLive(vercel: string | undefined): boolean {
  return vercel !== undefined && vercel !== '';
}
