import 'server-only';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import {
  mailboxAccess,
  mailboxUnlockAllowed,
  type MailboxAccess,
  type MailboxMessage,
  type MailboxSummary,
} from '@/lib/email/message';
import {
  mailboxListEntry,
  mailboxMessageEntry,
  mailboxUnlockEntry,
} from '@/lib/opsAudit';
import type { Caller } from '@/server/auth/caller';
import { holdsOpsRole } from '@/lib/opsNav';
import { recordAudit } from '@/server/db/audit';
import { findMailboxMessage, listMailboxSummaries } from '@/server/db/messages';
import { env } from '@/server/env';
import { secureEqual } from '@/server/hash';

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

function deployment(secret: string | null) {
  return {
    vercelEnv: env.VERCEL_ENV,
    emailMode: env.EMAIL_MODE,
    secretConfigured: secret !== null,
  };
}

function access(
  caller: Caller,
  cookie: string | undefined,
  secret: string | null,
): MailboxAccess {
  return mailboxAccess({
    ...deployment(secret),
    ops: holdsOpsRole(caller.roles),
    hasCookie: cookie !== undefined,
    cookieMatches:
      secret !== null &&
      cookie !== undefined &&
      secureEqual(cookie, sessionToken(secret)),
  });
}

/**
 * The cookie value for a submitted secret, or null when the lib refuses it. A right secret is
 * recorded before the cookie is issued, so a failed audit write issues none.
 */
export async function unlockMailbox(
  caller: Caller,
  submitted: string,
): Promise<string | null> {
  const secret = configuredSecret();
  const allowed = mailboxUnlockAllowed({
    ...deployment(secret),
    secretMatches: secret !== null && secureEqual(submitted, secret),
  });
  if (!allowed || secret === null) return null;
  await recordAudit(mailboxUnlockEntry(caller.userId));
  return sessionToken(secret);
}

/** The list for the ops role, or for a tester holding the secret's cookie off production. The read is recorded first. */
export async function loadMailbox(
  caller: Caller,
  cookie: string | undefined,
): Promise<Locked | { status: 'open'; messages: MailboxSummary[] }> {
  const result = access(caller, cookie, configuredSecret());
  if (result.status !== 'open') return { status: result.status };
  await recordAudit(mailboxListEntry(caller.userId, result.via));
  return { status: 'open', messages: await listMailboxSummaries() };
}

/** One message, recorded when it is found; a malformed or unknown id reads and records nothing. */
export async function loadMailboxMessage(
  caller: Caller,
  cookie: string | undefined,
  id: string,
): Promise<
  Locked | { status: 'missing' } | { status: 'open'; message: MailboxMessage }
> {
  const result = access(caller, cookie, configuredSecret());
  if (result.status !== 'open') return { status: result.status };
  if (!z.uuid().safeParse(id).success) return { status: 'missing' };
  const message = await findMailboxMessage(id);
  if (!message) return { status: 'missing' };
  await recordAudit(mailboxMessageEntry(caller.userId, result.via, message.id));
  return { status: 'open', message };
}
