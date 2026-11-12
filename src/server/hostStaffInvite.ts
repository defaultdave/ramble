import 'server-only';
import { randomUUID } from 'node:crypto';
import { EmailAddressSchema, normalizeEmailAddress } from '@/lib/email/address';
import { hostStaffLandingPath } from '@/lib/hostStaff';
import type { InviteResult } from '@/lib/opsForm';
import { signInLinkData } from '@/lib/signIn';
import { staffLinkSentEntry } from '@/lib/staffAudit';
import type { Caller } from '@/server/auth/caller';
import { appOrigin } from '@/server/auth/forms';
import {
  grantHostStaff,
  readHostStaffAddress,
  requireHostOwnerId,
} from '@/server/db/staffRoles';
import { sendSignInInvite } from './signInInvite';

function sendHostStaffLink(
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
      data: signInLinkData(token, appOrigin(), hostStaffLandingPath),
      idempotencyKey: `host-staff-link-${randomUUID()}`,
    }),
    failureLog: 'The host staff sign-in link could not be sent',
  });
}

/**
 * Gives an address the read-only staff role on the owner's host and emails it a sign-in link. An
 * address that already holds the role gets a fresh link and no second grant. As with ops staff,
 * the grant is committed before the link is tried, so a refused or failed link leaves it in place.
 */
export async function inviteHostStaff(
  caller: Caller,
  hostId: string,
  rawEmail: string,
): Promise<InviteResult> {
  const actorId = requireHostOwnerId(caller, hostId);
  // A caller hands over an address it has already read; one that is not an address is a bug, not input to repair.
  const email = EmailAddressSchema.parse(normalizeEmailAddress(rawEmail));
  const { userId } = await grantHostStaff(caller, hostId, email);
  return sendHostStaffLink(actorId, userId, email);
}

/** Sends a staff member of this host a new sign-in link. A person who is not its staff is not found, so the link cannot reach an address that is not. */
export async function resendHostStaffLink(
  caller: Caller,
  hostId: string,
  userId: string,
): Promise<InviteResult> {
  const actorId = requireHostOwnerId(caller, hostId);
  const email = await readHostStaffAddress(caller, hostId, userId);
  if (email === null) return 'not_found';
  return sendHostStaffLink(actorId, userId, email);
}
