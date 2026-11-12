import { userActor, type AuditEntryInput } from './audit';

export type MailboxVia = 'ops_role' | 'secret';

/**
 * Stable ids for the ops areas, which have no row of their own: the audit log names its subject by
 * uuid, so each area that is read as a whole gets one fixed id.
 */
export const opsAreaIds = {
  dashboard: '00000000-0000-4000-8000-0000000000a1',
  mailbox: '00000000-0000-4000-8000-0000000000a2',
  hosts: '00000000-0000-4000-8000-0000000000a3',
  support: '00000000-0000-4000-8000-0000000000a4',
} as const;

/** An ops area's list was read by a named ops user: one row, naming the area by its fixed id. */
export function opsAreaListEntry(
  userId: string,
  action: string,
  areaId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action,
    subjectKind: 'ops_area',
    subjectId: areaId,
  };
}

// A signed-in person is named; a tester who got in with the shared secret and no session is a guest.
function actor(userId: string | null) {
  return userId === null
    ? ({ actorKind: 'guest' } as const)
    : ({ actorKind: 'user', actorId: userId } as const);
}

/** The ops landing page was opened. */
export function opsAccessEntry(userId: string | null): AuditEntryInput {
  return {
    ...actor(userId),
    action: 'ops.accessed',
    subjectKind: 'ops_area',
    subjectId: opsAreaIds.dashboard,
    details: { area: 'dashboard' },
  };
}

/** The mailbox list was read, through the ops role or the shared secret. */
export function mailboxListEntry(
  userId: string | null,
  via: MailboxVia,
): AuditEntryInput {
  return {
    ...actor(userId),
    action: 'mailbox.listed',
    subjectKind: 'mailbox',
    subjectId: opsAreaIds.mailbox,
    details: { via },
  };
}

/** One message, which can hold a sign-in link, was read. */
export function mailboxMessageEntry(
  userId: string | null,
  via: MailboxVia,
  messageId: string,
): AuditEntryInput {
  return {
    ...actor(userId),
    action: 'mailbox.message_read',
    subjectKind: 'mailbox_message',
    subjectId: messageId,
    details: { via },
  };
}

/** The shared secret opened the mailbox for a tester. */
export function mailboxUnlockEntry(userId: string | null): AuditEntryInput {
  return {
    ...actor(userId),
    action: 'mailbox.unlocked',
    subjectKind: 'mailbox',
    subjectId: opsAreaIds.mailbox,
    details: { via: 'secret' },
  };
}
