import 'server-only';
import { EntityIdSchema } from '@/lib/catalog';
import { EmailAddressSchema, normalizeEmailAddress } from '@/lib/email/address';
import { hostStaffLandingPath, type HostInviteResult } from '@/lib/hostStaff';
import type { InviteResult } from '@/lib/opsForm';
import type { Caller } from '@/server/auth/caller';
import {
  grantHostStaff,
  readHostStaffAddress,
  requireHostOwnerId,
} from '@/server/db/staffRoles';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { sendStaffLink, type StaffLink } from './staffInvite';

const hostLink: StaffLink = {
  landingPath: hostStaffLandingPath,
  keyPrefix: 'host-staff-link',
  failureLog: 'The host staff sign-in link could not be sent',
};

/**
 * Gives an address the read-only staff role on the owner's host and emails it a sign-in link. An
 * owner who has sent too many invitations, or a host at its staff cap, gets no grant and no email.
 * An address that already holds the role gets a fresh link and no second grant. As with ops staff,
 * the grant is committed before the link is tried, so a refused or failed link leaves it in place.
 */
export async function inviteHostStaff(
  caller: Caller,
  hostId: string,
  rawEmail: string,
): Promise<HostInviteResult> {
  const id = EntityIdSchema.parse(hostId);
  const actorId = requireHostOwnerId(caller, id);
  // A caller hands over an address it has already read; one that is not an address is a bug, not input to repair.
  const email = EmailAddressSchema.parse(normalizeEmailAddress(rawEmail));
  const decision = await consumeRateLimit('host_staff_invite', actorId);
  if (!decision.allowed) return 'too_many_invites';
  const granted = await grantHostStaff(caller, id, email);
  if (granted === 'cap_reached') return granted;
  return sendStaffLink(actorId, granted.userId, email, hostLink);
}

/** Sends a staff member of this host a new sign-in link. A person who is not its staff is not found, so the link cannot reach an address that is not. */
export async function resendHostStaffLink(
  caller: Caller,
  hostId: string,
  userId: string,
): Promise<InviteResult> {
  const id = EntityIdSchema.parse(hostId);
  const actorId = requireHostOwnerId(caller, id);
  const email = await readHostStaffAddress(caller, id, userId);
  if (email === null) return 'not_found';
  return sendStaffLink(actorId, userId, email, hostLink);
}
