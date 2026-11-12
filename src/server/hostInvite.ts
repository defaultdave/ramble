import 'server-only';
import { randomUUID } from 'node:crypto';
import { hostInviteData } from '@/lib/email/hostInvite';
import { errorKind } from '@/lib/errorKind';
import { hostOwnerInviteEntry } from '@/lib/hostAudit';
import type { Caller } from '@/server/auth/caller';
import { appOrigin } from '@/server/auth/forms';
import { createSignInLinkToken } from '@/server/auth/signInLink';
import { recordAudit, requireOpsUserId } from '@/server/db/audit';
import { readHostInviteTarget } from '@/server/db/hostSetup';
import { logger } from '@/server/monitoring/logger';
import { sendEmail } from '@/server/ports/email';
import { consumeRateLimit } from '@/server/ports/rate-limit';

export type InviteResult = 'sent' | 'rate_limited' | 'failed' | 'not_found';

/**
 * Emails a host owner a first sign-in link. The address comes from the owner's grant on this
 * host, never from the request. It shares the sign-in link count for the address, so ops cannot
 * flood one; the count failing refuses the send. The audit row is written before the link is made.
 */
export async function inviteHostOwner(
  caller: Caller,
  hostId: string,
  ownerUserId: string,
): Promise<InviteResult> {
  const userId = requireOpsUserId(caller);
  const target = await readHostInviteTarget(caller, hostId, ownerUserId);
  if (target === null) return 'not_found';
  try {
    const decision = await consumeRateLimit('sign_in_link', target.email);
    if (!decision.allowed) return 'rate_limited';
    // Not one transaction: the link is stored by Better Auth's own connection and the email goes out
    // inline, as auth.ts sends its own sign-in links. The audit row comes first, so a request that
    // fails after it is still on record; the message log says whether the email left.
    await recordAudit(hostOwnerInviteEntry(userId, hostId, ownerUserId));
    const token = await createSignInLinkToken(target.email);
    await sendEmail({
      template: 'host-invite',
      to: target.email,
      data: hostInviteData(target.hostName, token, appOrigin()),
      idempotencyKey: `host-invite-${randomUUID()}`,
    });
    return 'sent';
  } catch (error) {
    logger.error('The host owner sign-in link could not be sent', {
      errorName: errorKind(error),
    });
    return 'failed';
  }
}
