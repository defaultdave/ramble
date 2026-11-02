import 'server-only';
import { auditExportKind, exportDaysDue, exportDedupeKey } from '@/lib/audit';
import { db } from '@/server/db/client';
import { readFirstAuditTime } from '@/server/db/audit';
import { logger } from '@/server/monitoring/logger';
import { systemClock } from '@/server/ports/clock';
import type { StoragePort } from '@/server/ports/storage';
import { getStorage } from '@/server/ports/storage/config';
import { enqueue } from './enqueue';

/**
 * Makes sure the recent complete days each have an export job, one dedupe key per day, so a day
 * queues once and a pulse outage shorter than the lookback catches up. Returns how many were new.
 * A day whose export fails every attempt stays dead and raises the `job-dead` alert; nothing
 * re-drives it yet, because its dedupe key stays used. A provider with no locked store queues
 * nothing and warns, so its days are not spent on jobs that cannot succeed. Judged on the system
 * clock for the reason given in `auditExport.ts`.
 */
export async function scheduleAuditExports(
  storage: StoragePort = getStorage(() => systemClock.now()),
): Promise<number> {
  if (!storage.storesAudit) {
    logger.warn(
      'audit export is off: no locked store is configured for this provider',
      { provider: storage.provider },
    );
    return 0;
  }
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
