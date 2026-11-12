import 'server-only';
import { randomUUID } from 'node:crypto';
import { EmailAddressSchema, normalizeEmailAddress } from '@/lib/email/address';
import type { InviteResult } from '@/lib/opsForm';
import { signInLinkData } from '@/lib/signIn';
import { staffGrant, staffLandingPath } from '@/lib/staffAdmin';
import { staffLinkSentEntry } from '@/lib/staffAudit';
import type { Caller } from '@/server/auth/caller';
import { appOrigin } from '@/server/auth/forms';
import { requireOpsUserId } from '@/server/db/audit';
import { db } from '@/server/db/client';
import {
  ensureAuthUserIn,
  grantRoleIn,
  readRoleHolder,
} from '@/server/db/staffRoles';
import { sendSignInInvite } from './signInInvite';

function sendStaffLink(
  actorId: string,
  userId: string,
  email: string,
): Promise<Exclude<InviteResult, 'not_found'>> {
  return sendSignInInvite({
    email,
    audit: staffLinkSentEntry(actorId, userId),
    request: (token) => ({
      template: 'sign-in-link',
      to: email,
      data: signInLinkData(token, appOrigin(), staffLandingPath),
      idempotencyKey: `staff-link-${randomUUID()}`,
    }),
    failureLog: 'The staff sign-in link could not be sent',
  });
}

/**
 * Gives an address the ops role (making its account if there is none) and emails it a sign-in
 * link. An address that already holds ops gets a fresh link and no second grant. The grant is
 * committed before the link is tried, so a refused or failed link leaves it in place and the link
 * can be sent again. A grant that cannot be written throws, as `createHost` does.
 */
export async function inviteStaff(
  caller: Caller,
  rawEmail: string,
): Promise<InviteResult> {
  const actorId = requireOpsUserId(caller);
  // A caller hands over an address it has already read; one that is not an address is a bug, not input to repair.
  const email = EmailAddressSchema.parse(normalizeEmailAddress(rawEmail));
  const userId = await db.transaction(async (tx) => {
    const id = await ensureAuthUserIn(tx, email);
    await grantRoleIn(tx, { kind: 'user', userId: actorId }, id, staffGrant);
    return id;
  });
  return sendStaffLink(actorId, userId, email);
}

/** Sends a staff member a new sign-in link. A person who does not hold ops is not found, so the link cannot reach an address that is not staff. */
export async function resendStaffLink(
  caller: Caller,
  userId: string,
): Promise<InviteResult> {
  const actorId = requireOpsUserId(caller);
  const holder = await readRoleHolder(caller, userId, staffGrant);
  if (holder === null) return 'not_found';
  return sendStaffLink(actorId, userId, holder.email);
}
