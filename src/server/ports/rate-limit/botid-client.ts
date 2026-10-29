import { botProtectedRoutes, shouldLoadBotId } from '@/lib/botChallenge';

// Browser side of the bot check. This file has no `server-only` import because the framework's
// client entry loads it; the server side is `bot-check.ts`. It imports nothing that pulls in Zod,
// whose eval probe Chromium reports as a CSP violation on every page.

/**
 * Starts BotID's challenge for the guest pages that need it. The script loads wherever this runs,
 * so it does nothing on checkout, gift, manage, orders, host, and ops paths (ADR 0003, ADR 0007),
 * and the SDK itself is imported only after that check, so those pages never download it.
 */
export async function startBotChallenge(pathname: string): Promise<void> {
  if (!shouldLoadBotId(pathname)) return;
  const { initBotId } = await import('botid/client/core');
  initBotId({ protect: [...botProtectedRoutes] });
}
