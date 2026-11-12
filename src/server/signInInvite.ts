import 'server-only';
import type { AuditEntryInput } from '@/lib/audit';
import type { EmailRequest } from '@/lib/email/templates';
import { errorKind } from '@/lib/errorKind';
import type { InviteResult } from '@/lib/opsForm';
import { createSignInLinkToken } from '@/server/auth/signInLink';
import { recordAudit } from '@/server/db/audit';
import { logger } from '@/server/monitoring/logger';
import { sendEmail } from '@/server/ports/email';
import { consumeRateLimit } from '@/server/ports/rate-limit';

export type SignInInvite = {
  /** The address the link goes to, for the sign-in link count. */
  email: string;
  /** Written before the link is made, so a request that fails after it is still on record. */
  audit: AuditEntryInput;
  /** Builds the message around the token. */
  request: (token: string) => EmailRequest;
  /** What is logged when the send fails; the error's kind is added, never its message. */
  failureLog: string;
};

/**
 * Emails one single-use sign-in link for an invite. It shares the sign-in link count for the
 * address, so ops cannot flood one, and a count that fails refuses the send. Not one transaction:
 * the link is stored by Better Auth's own connection and the email goes out inline, as auth.ts
 * sends its own sign-in links; the message log says whether the email left.
 */
export async function sendSignInInvite(
  invite: SignInInvite,
): Promise<Exclude<InviteResult, 'not_found'>> {
  try {
    const decision = await consumeRateLimit('sign_in_link', invite.email);
    if (!decision.allowed) return 'rate_limited';
    await recordAudit(invite.audit);
    const token = await createSignInLinkToken(invite.email);
    await sendEmail(invite.request(token));
    return 'sent';
  } catch (error) {
    logger.error(invite.failureLog, { errorName: errorKind(error) });
    return 'failed';
  }
}
