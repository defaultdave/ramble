export type BotVerdict = {
  isHuman: boolean;
  isBot: boolean;
  isVerifiedBot: boolean;
};

export type BotCheckResult = 'human' | 'bot';

/**
 * Passes only a verdict that says human and not bot. A verified crawler is still refused here:
 * it has no business holding spaces, signing in, or filing a form. A verdict that says neither
 * fails closed.
 */
export function judgeBotVerdict(verdict: BotVerdict): BotCheckResult {
  return verdict.isHuman && !verdict.isBot ? 'human' : 'bot';
}
