import 'server-only';
import {
  auditLimits,
  emptyExportTally,
  exportContentType,
  exportDayReady,
  exportLines,
  exportManifest,
  exportManifestKey,
  exportPartKey,
  exportStep,
  exportWindow,
  type AuditExportPayload,
  type ExportTally,
} from '@/lib/audit';
import { isAlreadyWritten } from '@/lib/storage';
import { readAuditPage } from '@/server/db/audit';
import { logger } from '@/server/monitoring/logger';
import { systemClock } from '@/server/ports/clock';
import { StorageError, type StoragePort } from '@/server/ports/storage';
import { getStorage } from '@/server/ports/storage/config';

// The export reads the system clock, not the pulse's clock: a demo `asOf` is another date, and an
// object written for a day that has not happened would lock out the day's real export, because an
// exported key is never written twice.

/** An object an earlier attempt already wrote is not an error: keys are written once. */
async function putOnce(
  storage: StoragePort,
  key: string,
  body: Uint8Array,
): Promise<void> {
  try {
    await storage.put({ key, body, contentType: exportContentType });
  } catch (error) {
    if (error instanceof StorageError && isAlreadyWritten(error.code)) {
      return;
    }
    throw error;
  }
}

/**
 * Writes one UTC day of the audit log to the audit store: numbered parts of up to 2,000 rows in id
 * order, then a manifest that says how many parts and rows there are. The manifest comes last and
 * is written for an empty day too, so its presence means the day was exported whole. It runs as
 * the job's `prepare`, before the transaction opens, so no connection is held while the store is
 * called, and it is safe to run twice: a key an earlier attempt wrote is skipped. A day that is
 * not over yet, or that needs more parts than the limit, fails and is retried or dead-lettered;
 * nothing is dropped.
 */
export async function exportAuditDay(
  payload: AuditExportPayload,
  storage: StoragePort = getStorage(() => systemClock.now()),
): Promise<ExportTally> {
  const { day } = payload;
  if (!exportDayReady(day, systemClock.now())) {
    throw new Error(`Audit day ${day} is not over yet`);
  }
  const window = exportWindow(day);
  let tally = emptyExportTally;
  let afterId = 0;
  for (;;) {
    const page = await readAuditPage(
      window,
      afterId,
      auditLimits.exportPageRows,
    );
    const step = exportStep(tally, page);
    if (step.action === 'refuse') {
      throw new Error(`Audit day ${day} needs more parts than the limit`);
    }
    if (step.action === 'finish') break;
    tally = step.tally;
    afterId = step.afterId;
    await putOnce(storage, exportPartKey(day, tally.parts), exportLines(page));
    if (step.last) break;
  }
  await putOnce(storage, exportManifestKey(day), exportManifest(day, tally));
  logger.info('audit day exported', {
    day,
    parts: tally.parts,
    rows: tally.rows,
  });
  return tally;
}
