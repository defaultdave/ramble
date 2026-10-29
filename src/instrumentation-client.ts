import { startBotChallenge } from '@/server/ports/rate-limit/botid-client';

// Runs in the browser before the app hydrates. BotID Basic needs no account step (ADR 0007).
void startBotChallenge(window.location.pathname);
