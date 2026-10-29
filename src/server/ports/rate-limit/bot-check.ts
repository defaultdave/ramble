import 'server-only';
import { checkBotId } from 'botid/server';
import {
  botCheckIsLive,
  BotVerdictSchema,
  judgeBotVerdict,
  type BotCheckResult,
  type BotVerdict,
} from '@/lib/botCheck';
import { env } from '@/server/env';

export type BotVerdictSource = () => Promise<BotVerdict>;

// The SDK's own types promise booleans, but it does not look at the HTTP status of its lookup, so
// the answer is parsed here and a malformed one throws.
async function botIdVerdict(): Promise<BotVerdict> {
  return BotVerdictSchema.parse(await checkBotId());
}

// TODO(U-004a): call it on the sign-in request too, and on the guest forms (U-038, U-043). Each adds
// its path to `botProtectedRoutes` in `src/lib/botChallenge.ts`.
/**
 * Asks BotID whether the request comes from a person. Call it on reserve, sign-in, and guest
 * forms only: checkout carries no third-party scripts (ADR 0003, ADR 0007), and a test fails the
 * build if a checkout file imports this module. `source` replaces the BotID call with a given
 * verdict. A failed or malformed lookup throws, so a caller fails closed.
 */
export async function checkBot(
  source: BotVerdictSource | undefined = botCheckIsLive(env.VERCEL)
    ? botIdVerdict
    : undefined,
): Promise<BotCheckResult> {
  if (!source) return 'human';
  return judgeBotVerdict(await source());
}
