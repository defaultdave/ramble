import { userActor, type AuditEntryInput } from './audit';
import type { PauseKind } from './experiencePause';
import type { HostEditableField } from './hostSetup';
import { opsAreaIds, opsAreaListEntry } from './opsAudit';

// The audit rows of host setup. An ops user does these, so the actor is always a named user.
// Details hold ids and flags only: the audit log refuses a name or an address.

// The details keys are lower-case words, so a field name is written in snake case.
const snakeCase = (field: string) =>
  field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** The hosts list was read. */
export const hostListEntry = (userId: string): AuditEntryInput =>
  opsAreaListEntry(userId, 'host.list_viewed', opsAreaIds.hosts);

/** The new-host form was opened. */
export const hostFormEntry = (userId: string): AuditEntryInput =>
  opsAreaListEntry(userId, 'host.form_viewed', opsAreaIds.hosts);

/** One host, with its owners' addresses, was read. */
export function hostViewEntry(userId: string, hostId: string): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'host.viewed',
    subjectKind: 'host',
    subjectId: hostId,
  };
}

export function hostCreatedEntry(
  userId: string,
  hostId: string,
  ownerUserId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'host.created',
    subjectKind: 'host',
    subjectId: hostId,
    details: { owner_user_id: ownerUserId },
  };
}

export function hostUpdatedEntry(
  userId: string,
  hostId: string,
  changed: readonly HostEditableField[],
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'host.updated',
    subjectKind: 'host',
    subjectId: hostId,
    details: Object.fromEntries(
      changed.map((field) => [`changed_${snakeCase(field)}`, true]),
    ),
  };
}

export function hostAgreementAcceptedEntry(
  userId: string,
  hostId: string,
  legalDocumentId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'host.agreement_accepted',
    subjectKind: 'host',
    subjectId: hostId,
    details: { legal_document_id: legalDocumentId },
  };
}

/** A sign-in link was requested for a host owner, recorded before it is made and sent. */
export function hostOwnerInviteEntry(
  userId: string,
  hostId: string,
  ownerUserId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'host.owner_invited',
    subjectKind: 'host',
    subjectId: hostId,
    details: { owner_user_id: ownerUserId },
  };
}

/** A host suspended or unsuspended by ops, with how many experiences that paused or unpaused. */
export function hostSuspensionEntry(
  userId: string,
  hostId: string,
  kind: PauseKind,
  changedCount: number,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: kind === 'pause' ? 'host.suspended' : 'host.unsuspended',
    subjectKind: 'host',
    subjectId: hostId,
    details: { experiences_changed: changedCount },
  };
}
