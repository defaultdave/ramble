import 'server-only';
import { exportWindow, type ExportDay } from '@/lib/audit';
import { splitPage } from '@/lib/pagination';
import {
  auditPageSize,
  auditViewRow,
  type AuditViewRow,
} from '@/lib/staffAdmin';
import { auditViewedEntry } from '@/lib/staffAudit';
import type { Caller } from '@/server/auth/caller';
import { readAuditPage, recordAudit, requireOpsUserId } from './audit';

export type AuditViewPage = {
  rows: AuditViewRow[];
  nextCursor: string | null;
};

/**
 * One page of a UTC day of the audit log, oldest first, after the row id the cursor names. Ops
 * alone; the read is itself recorded before it returns, so who looked is on the log too.
 */
export async function readAuditForOps(
  caller: Caller,
  day: ExportDay,
  afterId: number,
): Promise<AuditViewPage> {
  const actorId = requireOpsUserId(caller);
  const fetched = await readAuditPage(
    exportWindow(day),
    afterId,
    auditPageSize + 1,
  );
  const { items, nextCursor } = splitPage(
    fetched.map(auditViewRow),
    auditPageSize,
  );
  await recordAudit(auditViewedEntry(actorId, day));
  return { rows: items, nextCursor };
}
