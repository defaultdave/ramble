import { z } from 'zod';

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

/** `VERCEL` is set on every Vercel build and runtime and nowhere else, so local runs, tests, and CI skip the lookup. */
export function botCheckIsLive(vercel: string | undefined): boolean {
  return vercel !== undefined && vercel !== '';
}
