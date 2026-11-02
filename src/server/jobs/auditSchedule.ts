import 'server-only';
import { auditExportKind, exportDaysDue, exportDedupeKey } from '@/lib/audit';
import { db } from '@/server/db/client';
import { readFirstAuditTime } from '@/server/db/audit';
import { systemClock } from '@/server/ports/clock';
import { enqueue } from './enqueue';

/**
 * Makes sure the recent complete days each have an export job, one dedupe key per day, so a day
 * queues once and an outage shorter than the lookback catches up. Returns how many were new. A
 * dead export keeps its key; ops re-runs that day by hand. Judged on the system clock for the
 * reason given in `auditExport.ts`.
 */
export async function scheduleAuditExports(): Promise<number> {
  const days = exportDaysDue(systemClock.now(), await readFirstAuditTime());
  return db.transaction(async (tx) => {
    let queued = 0;
    for (const day of days) {
      const job = await enqueue(tx, {
        kind: auditExportKind,
        payload: { day },
        dedupeKey: exportDedupeKey(day),
      });
      if (job) queued += 1;
    }
    return queued;
  });
}
