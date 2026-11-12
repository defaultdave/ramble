import 'server-only';
import { randomUUID } from 'node:crypto';
import { hostInviteData } from '@/lib/email/hostInvite';
import { hostOwnerInviteEntry } from '@/lib/hostAudit';
import type { InviteResult } from '@/lib/opsForm';
import type { Caller } from '@/server/auth/caller';
import { appOrigin } from '@/server/auth/forms';
import { requireOpsUserId } from '@/server/db/audit';
import { readHostInviteTarget } from '@/server/db/hostSetup';
import { sendSignInInvite } from './signInInvite';

/**
 * Emails a host owner a first sign-in link. The address comes from the owner's grant on this
 * host, never from the request.
 */
export async function inviteHostOwner(
  caller: Caller,
  hostId: string,
  ownerUserId: string,
): Promise<InviteResult> {
  const userId = requireOpsUserId(caller);
  const target = await readHostInviteTarget(caller, hostId, ownerUserId);
  if (target === null) return 'not_found';
  return sendSignInInvite({
    email: target.email,
    audit: hostOwnerInviteEntry(userId, hostId, ownerUserId),
    request: (token) => ({
      template: 'host-invite',
      to: target.email,
      data: hostInviteData(target.hostName, token, appOrigin()),
      idempotencyKey: `host-invite-${randomUUID()}`,
    }),
    failureLog: 'The host owner sign-in link could not be sent',
  });
}
