import 'server-only';
import { and, asc, gt, gte, lt } from 'drizzle-orm';
import {
  parseAuditEntry,
  type AuditEntryInput,
  type AuditRow,
} from '@/lib/audit';
import { opsAccessEntry } from '@/lib/opsAudit';
import {
  ForbiddenError,
  requireRole,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { db, type Transaction } from './client';
import { auditLog } from './schema';

/**
 * Writes one audit row in the caller's transaction, so it exists exactly when the change it
 * records does. The parameter type accepts a transaction only; the plain `db` handle does not
 * fit. It takes no caller: the path that calls it has already authorized the action, as with
 * `postEntries`. Throws, and writes nothing, on an entry the lib refuses.
 */
export async function writeAudit(
  tx: Transaction,
  entry: AuditEntryInput,
): Promise<{ id: number }> {
  const [row] = await tx
    .insert(auditLog)
    .values(parseAuditEntry(entry))
    .returning({ id: auditLog.id });
  if (!row) throw new Error('The audit row was not written');
  return row;
}

/**
 * Writes one audit row in a transaction of its own, for an action that changes nothing else: a
 * read of something sensitive. It throws if the row is not written, so the caller returns nothing
 * it has not recorded. Like `writeAudit` it takes no caller; the path that calls it has already
 * authorized the action.
 */
export async function recordAudit(entry: AuditEntryInput): Promise<void> {
  await db.transaction((tx) => writeAudit(tx, entry));
}

/**
 * The id of the ops user behind this caller, for an audit row that names who acted. Throws
 * ForbiddenError for anyone without the ops role; an ops caller always has a user.
 */
export function requireOpsUserId(caller: Caller): string {
  requireRole(caller, Role.Ops, {});
  return requireUserId(caller, Role.Ops);
}

/**
 * The id of the user behind this caller, for an audit row that names who acted, when the caller's
 * `role` has already been checked against its row. Throws ForbiddenError for a caller with no user.
 */
export function requireUserId(caller: Caller, role: Role): string {
  if (caller.userId === null) throw new ForbiddenError(role);
  return caller.userId;
}

/** Records the ops user opening the ops area. Throws ForbiddenError, and writes nothing, for anyone else. */
export async function recordOpsAccess(caller: Caller): Promise<void> {
  requireRole(caller, Role.Ops, {});
  await recordAudit(opsAccessEntry(caller.userId));
}

/** The time of the earliest audit row (an index read), or null for an empty log: where the export schedule starts. */
export async function readFirstAuditTime(): Promise<Date | null> {
  const [row] = await db
    .select({ recordedAt: auditLog.recordedAt })
    .from(auditLog)
    .orderBy(asc(auditLog.recordedAt))
    .limit(1);
  return row?.recordedAt ?? null;
}

/**
 * Up to `limit` rows recorded in [from, to) with an id past `afterId`, in id order. Paging by id
 * visits every row of the window once, even if rows commit out of time order.
 */
export async function readAuditPage(
  window: { from: Date; to: Date },
  afterId: number,
  limit: number,
): Promise<AuditRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(
      and(
        gte(auditLog.recordedAt, window.from),
        lt(auditLog.recordedAt, window.to),
        gt(auditLog.id, afterId),
      ),
    )
    .orderBy(asc(auditLog.id))
    .limit(limit);
}
