import {
  userActor,
  userOrSystemActor,
  type AuditEntryInput,
  type ExportDay,
} from './audit';
import { opsAreaIds } from './opsAudit';
import type { GrantableRole, RoleGrant } from './roleGrants';

// The audit rows of staff and roles admin. A grant is written by a named ops user, or by the grant
// command (the system) when nobody is signed in yet. Details hold ids and role names only.

/** Who made a change: a signed-in ops user, or the command line that bootstraps the first account. */
export type RoleActor = { kind: 'user'; userId: string } | { kind: 'system' };

function actorFields(actor: RoleActor) {
  return userOrSystemActor(actor.kind === 'user' ? actor.userId : null);
}

function grantDetails(grant: { role: GrantableRole; hostId: string | null }) {
  return grant.hostId === null
    ? { role: grant.role }
    : { role: grant.role, host_id: grant.hostId };
}

export function roleGrantedEntry(
  actor: RoleActor,
  userId: string,
  grant: RoleGrant,
): AuditEntryInput {
  return {
    ...actorFields(actor),
    action: 'role.granted',
    subjectKind: 'auth_user',
    subjectId: userId,
    details: grantDetails(grant),
  };
}

export function roleRevokedEntry(
  actorUserId: string,
  userId: string,
  grant: RoleGrant,
): AuditEntryInput {
  return {
    ...userActor(actorUserId),
    action: 'role.revoked',
    subjectKind: 'auth_user',
    subjectId: userId,
    details: grantDetails(grant),
  };
}

/** A sign-in link was requested for a staff member, recorded before it is made and sent. */
export function staffLinkSentEntry(
  actorUserId: string,
  userId: string,
): AuditEntryInput {
  return {
    ...userActor(actorUserId),
    action: 'staff.link_sent',
    subjectKind: 'auth_user',
    subjectId: userId,
  };
}

export function staffListedEntry(actorUserId: string): AuditEntryInput {
  return {
    ...userActor(actorUserId),
    action: 'staff.list_viewed',
    subjectKind: 'ops_area',
    subjectId: opsAreaIds.staff,
  };
}

/** The audit log itself was read, for one day. */
export function auditViewedEntry(
  actorUserId: string,
  day: ExportDay,
): AuditEntryInput {
  return {
    ...userActor(actorUserId),
    action: 'audit.viewed',
    subjectKind: 'ops_area',
    subjectId: opsAreaIds.audit,
    details: { day },
  };
}
