import 'server-only';
import { randomUUID } from 'node:crypto';
import { EmailAddressSchema, normalizeEmailAddress } from '@/lib/email/address';
import { errorKind } from '@/lib/errorKind';
import {
  invitedRole,
  staffLinkData,
  type StaffInviteResult,
} from '@/lib/staffAdmin';
import { staffLinkSentEntry } from '@/lib/staffAudit';
import type { Caller } from '@/server/auth/caller';
import { appOrigin } from '@/server/auth/forms';
import { createSignInLinkToken } from '@/server/auth/signInLink';
import { recordAudit, requireOpsUserId } from '@/server/db/audit';
import { db } from '@/server/db/client';
import {
  ensureAuthUserIn,
  grantRoleIn,
  readStaffInviteTarget,
} from '@/server/db/staffRoles';
import { logger } from '@/server/monitoring/logger';
import { sendEmail } from '@/server/ports/email';
import { consumeRateLimit } from '@/server/ports/rate-limit';

/**
 * Sends one sign-in link. It shares the sign-in link count for the address, so ops cannot flood
 * one, and a count that fails refuses the send. The audit row comes before the link is made: the
 * link is stored by Better Auth's own connection and the email goes out inline, so a request that
 * fails after the row is still on record. The link is single-use and lives as long as any other.
 */
async function sendStaffLink(
  actorId: string,
  userId: string,
  email: string,
): Promise<StaffInviteResult> {
  try {
    const decision = await consumeRateLimit('sign_in_link', email);
    if (!decision.allowed) return 'rate_limited';
    await recordAudit(staffLinkSentEntry(actorId, userId));
    const token = await createSignInLinkToken(email);
    await sendEmail({
      template: 'sign-in-link',
      to: email,
      data: staffLinkData(token, appOrigin()),
      idempotencyKey: `staff-link-${randomUUID()}`,
    });
    return 'sent';
  } catch (error) {
    logger.error('The staff sign-in link could not be sent', {
      errorName: errorKind(error),
    });
    return 'failed';
  }
}

/**
 * Gives an address the ops role (making its account if there is none) and emails it a sign-in
 * link. An address that already holds ops gets a fresh link and no second grant. A failure after
 * the grant leaves the grant in place and says `failed`, so the link can be sent again.
 */
export async function inviteStaff(
  caller: Caller,
  rawEmail: string,
): Promise<StaffInviteResult> {
  const actorId = requireOpsUserId(caller);
  // A caller hands over an address it has already read; one that is not an address is a bug, not input to repair.
  const email = EmailAddressSchema.parse(normalizeEmailAddress(rawEmail));
  let userId: string;
  try {
    userId = await db.transaction(async (tx) => {
      const id = await ensureAuthUserIn(tx, email);
      await grantRoleIn(tx, { kind: 'user', userId: actorId }, id, {
        role: invitedRole,
        hostId: null,
      });
      return id;
    });
  } catch (error) {
    logger.error('The staff grant could not be written', {
      errorName: errorKind(error),
    });
    return 'failed';
  }
  return sendStaffLink(actorId, userId, email);
}

/** Sends a staff member a new sign-in link. A person who does not hold ops is not found, so the link cannot reach an address that is not staff. */
export async function resendStaffLink(
  caller: Caller,
  userId: string,
): Promise<StaffInviteResult> {
  const actorId = requireOpsUserId(caller);
  const target = await readStaffInviteTarget(caller, userId);
  if (target === null) return 'not_found';
  return sendStaffLink(actorId, userId, target.email);
}
