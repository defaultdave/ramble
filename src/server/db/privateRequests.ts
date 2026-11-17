import 'server-only';
import { and, count, eq } from 'drizzle-orm';
import {
  buildOpsRequestRows,
  requestsListEntry,
  type OpsRequestRow,
} from '@/lib/opsRequests';
import { splitPage } from '@/lib/pagination';
import type { PrivateRequestInput } from '@/lib/privateSession';
import { opsListPageSize } from '@/lib/tableQuery';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { recordAudit, requireOpsUserId } from './audit';
import { guestVisible } from './catalog';
import { dbRead, type Transaction } from './client';
import { byColumnThenId, pastKeysetCursor } from './keysetPage';
import { experiences, privateRequests } from './schema';

/**
 * Writes one request in the caller's transaction, so it exists exactly when the notice queued with
 * it does. Throws, and writes nothing, when the experience is missing or not visible to guests:
 * a form for a page a guest cannot open was not made by a guest.
 */
export async function insertPrivateRequest(
  tx: Transaction,
  experienceId: string,
  input: PrivateRequestInput,
): Promise<{ id: string; createdAt: Date; experienceName: string }> {
  const [experience] = await tx
    .select({ name: experiences.name })
    .from(experiences)
    .where(and(eq(experiences.id, experienceId), guestVisible));
  if (!experience) throw new Error('The experience takes no private requests');

  const [row] = await tx
    .insert(privateRequests)
    .values({
      experienceId,
      requestedDate: input.date,
      groupSize: input.groupSize,
      budgetMinor: input.budgetMinor,
      name: input.name,
      email: input.email,
      message: input.message,
    })
    .returning({
      id: privateRequests.id,
      createdAt: privateRequests.createdAt,
    });
  if (!row) throw new Error('The private request was not written');
  return { ...row, experienceName: experience.name };
}

export type OpsRequestsPage = {
  rows: OpsRequestRow[];
  nextCursor: string | null;
};

/**
 * One page of private requests for the ops role alone, newest first, each with its experience's
 * name. The read records its audit row before it returns anything.
 */
export async function readOpsPrivateRequests(
  caller: Caller,
  options: { cursor: string | null },
): Promise<OpsRequestsPage> {
  const userId = requireOpsUserId(caller);
  const fetched = await dbRead
    .select({
      id: privateRequests.id,
      experienceName: experiences.name,
      requestedDate: privateRequests.requestedDate,
      groupSize: privateRequests.groupSize,
      budgetMinor: privateRequests.budgetMinor,
      name: privateRequests.name,
      email: privateRequests.email,
      message: privateRequests.message,
      createdAt: privateRequests.createdAt,
    })
    .from(privateRequests)
    .innerJoin(experiences, eq(experiences.id, privateRequests.experienceId))
    .where(
      pastKeysetCursor(
        privateRequests,
        privateRequests.createdAt,
        'desc',
        options.cursor,
      ),
    )
    .orderBy(
      ...byColumnThenId(privateRequests, privateRequests.createdAt, 'desc'),
    )
    .limit(opsListPageSize + 1);
  const { items, nextCursor } = splitPage(fetched, opsListPageSize);
  await recordAudit(requestsListEntry(userId));
  return { rows: buildOpsRequestRows(items), nextCursor };
}

/**
 * How many private requests have been received, all of them. Ops alone. It names no one, so it
 * records no audit row: the page that shows it records the visit.
 */
export async function countOpsPrivateRequests(caller: Caller): Promise<number> {
  requireRole(caller, Role.Ops, {});
  const [row] = await dbRead.select({ total: count() }).from(privateRequests);
  return row?.total ?? 0;
}
