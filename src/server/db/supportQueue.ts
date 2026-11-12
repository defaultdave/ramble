import 'server-only';
import { and, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { splitPage } from '@/lib/pagination';
import {
  buildSupportQueueRows,
  supportListEntry,
  supportQueuePageSize,
  supportResolvedEntry,
  supportResolveOutcome,
  type SupportResolveInput,
  type SupportResolveOutcome,
  type SupportQueueRow,
  type SupportStatus,
} from '@/lib/supportQueue';
import type { Caller } from '@/server/auth/caller';
import { recordAudit, requireOpsUserId, writeAudit } from './audit';
import { db, dbRead } from './client';
import { byColumnThenId, pastKeysetCursor } from './keysetPage';
import { supportRequests } from './schema';

// For the ops role alone: each function checks it, and the read records its audit row before it returns anything.

export type SupportQueuePage = {
  rows: SupportQueueRow[];
  nextCursor: string | null;
};

const statusCondition = {
  open: isNull(supportRequests.resolvedAt),
  resolved: isNotNull(supportRequests.resolvedAt),
} satisfies Record<SupportStatus, SQL>;

/** One page of requests, newest first, optionally only open or only resolved ones. */
export async function readSupportQueue(
  caller: Caller,
  options: { status: SupportStatus | null; cursor: string | null },
): Promise<SupportQueuePage> {
  const userId = requireOpsUserId(caller);
  const fetched = await dbRead
    .select()
    .from(supportRequests)
    .where(
      and(
        options.status === null ? undefined : statusCondition[options.status],
        pastKeysetCursor(
          supportRequests,
          supportRequests.createdAt,
          'desc',
          options.cursor,
        ),
      ),
    )
    .orderBy(
      ...byColumnThenId(supportRequests, supportRequests.createdAt, 'desc'),
    )
    .limit(supportQueuePageSize + 1);
  const { items, nextCursor } = splitPage(fetched, supportQueuePageSize);
  await recordAudit(supportListEntry(userId));
  return { rows: buildSupportQueueRows(items), nextCursor };
}

/** Marks one request resolved with a note and records who did it, in one transaction. A resolved request is left as it was. */
export async function resolveSupportRequest(
  caller: Caller,
  input: SupportResolveInput,
): Promise<SupportResolveOutcome> {
  const userId = requireOpsUserId(caller);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ resolvedAt: supportRequests.resolvedAt })
      .from(supportRequests)
      .where(eq(supportRequests.id, input.id))
      .for('update');
    const outcome = supportResolveOutcome(current);
    if (outcome !== 'resolved') return outcome;
    await tx
      .update(supportRequests)
      .set({
        resolvedAt: sql`clock_timestamp()`,
        resolutionNote: input.note,
      })
      .where(eq(supportRequests.id, input.id));
    await writeAudit(tx, supportResolvedEntry(userId, input.id));
    return outcome;
  });
}
