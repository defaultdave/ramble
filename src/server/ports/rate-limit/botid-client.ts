import { initBotId } from 'botid/client/core';
import { botProtectedRoutes, shouldLoadBotId } from '@/lib/botCheck';

// Browser side of the bot check. This file has no `server-only` import because the framework's
// client entry loads it; the server side is `bot-check.ts`.

/**
 * Starts BotID's challenge for the guest pages that need it. The script loads wherever this runs,
 * so it does nothing on checkout, gift, manage, orders, host, and ops paths (ADR 0003, ADR 0007).
 */
export function startBotChallenge(pathname: string): void {
  if (!shouldLoadBotId(pathname)) return;
  initBotId({ protect: [...botProtectedRoutes] });
}
