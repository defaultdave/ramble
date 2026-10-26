import 'server-only';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import {
  mailboxAccess,
  type MailboxMessage,
  type MailboxSummary,
} from '@/lib/email/message';
import { findMailboxMessage, listMailboxSummaries } from '@/server/db/messages';
import { env } from '@/server/env';
import { secureEqual } from '@/server/secureEqual';

export const mailboxCookieName = 'ramble_dev_mailbox';
export const mailboxCookieMaxAgeSeconds = 8 * 60 * 60;
export const mailboxPath = '/ops/mailbox';

type Locked = { status: 'disabled' | 'locked' };

function configuredSecret(): string | null {
  return env.DEV_MAILBOX_SECRET ?? null;
}

// The cookie proves knowledge of the secret without carrying it, and changes when the secret does.
function sessionToken(secret: string): string {
  return createHmac('sha256', secret)
    .update('ramble-dev-mailbox-session-v1')
    .digest('hex');
}

/** The cookie value for a submitted secret, or null when the mailbox is off or the secret is wrong. */
export function unlockMailbox(submitted: string): string | null {
  const secret = configuredSecret();
  if (gate(undefined) === 'disabled' || secret === null) return null;
  return secureEqual(submitted, secret) ? sessionToken(secret) : null;
}

function gate(cookie: string | undefined): 'disabled' | 'locked' | 'open' {
  const secret = configuredSecret();
  return mailboxAccess({
    liveMode: env.EMAIL_MODE === 'live',
    secretConfigured: secret !== null,
    hasCookie: cookie !== undefined,
    cookieMatches:
      secret !== null &&
      cookie !== undefined &&
      secureEqual(cookie, sessionToken(secret)),
  });
}

// TODO(U-004a): replace the shared secret with requireRole(caller, Role.Ops, {}).
export async function loadMailbox(
  cookie: string | undefined,
): Promise<Locked | { status: 'open'; messages: MailboxSummary[] }> {
  const access = gate(cookie);
  if (access !== 'open') return { status: access };
  return { status: 'open', messages: await listMailboxSummaries() };
}

// TODO(U-004a): replace the shared secret with requireRole(caller, Role.Ops, {}).
export async function loadMailboxMessage(
  cookie: string | undefined,
  id: string,
): Promise<
  Locked | { status: 'missing' } | { status: 'open'; message: MailboxMessage }
> {
  const access = gate(cookie);
  if (access !== 'open') return { status: access };
  if (!z.uuid().safeParse(id).success) return { status: 'missing' };
  const message = await findMailboxMessage(id);
  return message ? { status: 'open', message } : { status: 'missing' };
}
