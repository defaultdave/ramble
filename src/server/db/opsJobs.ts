import 'server-only';
import { desc } from 'drizzle-orm';
import { buildOpsJobRow, type OpsJobRow } from '@/lib/opsDev';
import { db } from './client';
import { jobs } from './schema';

/** How many jobs the console lists: the latest by when they were queued. */
const opsJobsShown = 50;

/**
 * The newest jobs for the test console, read on the primary: a tester who has just run a job
 * must see its new state, which a replica may not have yet. `last_error` is already redacted when
 * it is written, and the payload is not read.
 */
export async function readRecentJobs(): Promise<OpsJobRow[]> {
  const rows = await db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      runAfter: jobs.runAfter,
      lastError: jobs.lastError,
    })
    .from(jobs)
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(opsJobsShown);
  return rows.map(buildOpsJobRow);
}
