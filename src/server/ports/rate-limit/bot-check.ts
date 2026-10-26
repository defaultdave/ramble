import 'server-only';
import { checkBotId } from 'botid/server';
import {
  judgeBotVerdict,
  type BotCheckResult,
  type BotVerdict,
} from '@/lib/botCheck';
import { env } from '@/server/env';

export type BotVerdictSource = () => Promise<BotVerdict>;

async function botIdVerdict(): Promise<BotVerdict> {
  const { isHuman, isBot, isVerifiedBot } = await checkBotId();
  return { isHuman, isBot, isVerifiedBot };
}

// Off the platform there is no BotID to ask: `VERCEL` is set on every Vercel build and runtime
// and nowhere else, so local runs, tests, and `next start` in CI pass without it.
function defaultSource(): BotVerdictSource | undefined {
  return env.VERCEL ? botIdVerdict : undefined;
}

// TODO(U-014a): first caller, on `reserveSpaces`; U-004a (sign-in request), U-038 and U-043 (forms) follow.
// TODO(U-014a): the BotID client script (`initBotId`) and `withBotId` in next.config for the
// protected paths, which exist only once the first caller does.
/**
 * Asks BotID whether the request comes from a person. Call it on reserve, sign-in, and guest
 * forms only: checkout carries no third-party scripts (ADR 0003, ADR 0007), and a test fails the
 * build if a checkout file imports this module. `source` replaces the BotID call with a given
 * verdict. A failed lookup throws, so a caller fails closed.
 */
export async function checkBot(
  source: BotVerdictSource | undefined = defaultSource(),
): Promise<BotCheckResult> {
  if (!source) return 'human';
  return judgeBotVerdict(await source());
}
