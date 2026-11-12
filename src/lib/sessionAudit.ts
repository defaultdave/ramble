import { userOrSystemActor, type AuditEntryInput } from './audit';
import { opsAreaIds, opsAreaListEntry, opsViewEntry } from './opsAudit';

// The audit rows of session management. Details hold ids and numbers only.

/** The ops sessions list was read. */
export const sessionsListEntry = (userId: string): AuditEntryInput =>
  opsAreaListEntry(userId, 'sessions.list_viewed', opsAreaIds.sessions);

/** A session's capacity was changed, with the capacity before and after. */
export function sessionAllocationChangedEntry(input: {
  userId: string | null;
  sessionId: string;
  from: number;
  to: number;
}): AuditEntryInput {
  return {
    ...userOrSystemActor(input.userId),
    action: 'session.allocation_changed',
    subjectKind: 'session',
    subjectId: input.sessionId,
    details: { from: input.from, to: input.to },
  };
}

/** One session's guest impact was read: it names bookings by reference and amount. */
export const sessionViewedEntry = (
  userId: string,
  sessionId: string,
): AuditEntryInput =>
  opsViewEntry(userId, 'session.viewed', 'session', sessionId);
