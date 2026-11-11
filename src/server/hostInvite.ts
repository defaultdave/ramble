import 'server-only';
import { randomInt, randomUUID } from 'node:crypto';
import { signInLinkTtlSeconds } from '@/lib/auth';
import { hostInviteData } from '@/lib/email/hostInvite';
import { errorKind } from '@/lib/errorKind';
import { hostOwnerInviteEntry } from '@/lib/hostAudit';
import type { Caller } from '@/server/auth/caller';
import { getAuth } from '@/server/auth/auth';
import { hashSignInToken } from '@/server/auth/signInToken';
import { recordAudit, requireOpsUserId } from '@/server/db/audit';
import { readHostInviteTarget } from '@/server/db/hostSetup';
import { env } from '@/server/env';
import { logger } from '@/server/monitoring/logger';
import { systemClock } from '@/server/ports/clock';
import { sendEmail } from '@/server/ports/email';
import { consumeRateLimit } from '@/server/ports/rate-limit';

// Letters only, 32 of them, the shape Better Auth gives its own tokens; the confirm page accepts letters and digits.
const tokenAlphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const tokenLength = 32;

export type InviteResult = 'sent' | 'rate_limited' | 'failed' | 'not_found';

/**
 * Better Auth's own storage for a magic link: the identifier is the keyed hash of the token behind
 * the plugin's prefix, and the value is the record the verify step parses. The invite mints the
 * link itself, because the plugin's own request sends the generic sign-in email and this one
 * carries the host's name. The link lives as long as any sign-in link (ADR 0002).
 */
async function mintSignInToken(email: string): Promise<string> {
  const token = Array.from({ length: tokenLength }, () =>
    tokenAlphabet.charAt(randomInt(tokenAlphabet.length)),
  ).join('');
  const context = await getAuth().$context;
  await context.internalAdapter.createVerificationValue({
    identifier: `magic-link:${await hashSignInToken(token)}`,
    value: JSON.stringify({ type: 'magic-link', email }),
    expiresAt: new Date(
      systemClock.now().getTime() + signInLinkTtlSeconds * 1000,
    ),
  });
  return token;
}

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
    await recordAudit(hostOwnerInviteEntry(userId, hostId, ownerUserId));
    const token = await mintSignInToken(target.email);
    await sendEmail({
      template: 'host-invite',
      to: target.email,
      data: hostInviteData(target.hostName, token, new URL(env.APP_URL).origin),
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
