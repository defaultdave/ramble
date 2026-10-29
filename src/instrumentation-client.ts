import { initBotId } from 'botid/client/core';
import { botProtectedRoutes, shouldLoadBotId } from '@/lib/botCheck';

// Runs in the browser before the app hydrates. BotID Basic needs no account step (ADR 0007).
if (shouldLoadBotId(window.location.pathname)) {
  initBotId({ protect: [...botProtectedRoutes] });
}
