import 'server-only';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { CacheChange } from '@/lib/cacheTags';
import { WriteIdSchema } from '@/lib/catalog';
import { experiencePauseEntry } from '@/lib/experienceAudit';
import type { ExperienceStatus } from '@/lib/experienceEditor';
import {
  experienceOutcome,
  hostChanges,
  hostOutcome,
  noSuspension,
  pausableStatuses,
  pauseRefusal,
  pausedStatus,
  restoredStatus,
  type HostSuspension,
  type PauseKind,
  type PauseRefusal,
} from '@/lib/experiencePause';
import { hostSuspensionEntry } from '@/lib/hostAudit';
import type { Caller } from '@/server/auth/caller';
import { requireOpsUserId, writeAudit } from './audit';
import { dbRead, type Transaction } from './client';
import { placeChanges } from './experienceEditor';
import {
  hostIsSuspended,
  withLockedExperience,
  withLockedHost,
  type LockedExperience,
} from './lockedExperience';
import { auditLog, experiences } from './schema';

export type PauseResult =
  { status: 'paused' | 'unpaused' | 'not_found' } | PauseRefusal;

export type HostPauseResult = {
  status:
    | 'suspended'
    | 'unsuspended'
    | 'not_found'
    | 'nothing_to_suspend'
    | 'nothing_to_unsuspend';
};

/**
 * True for an experience whose latest pause or unpause, in the audit log, was a pause made by
 * suspending its host. The host has no status of its own, so this is how an unsuspend tells the
 * experiences the suspension paused from one ops paused by hand, or one that was paused some
 * other way and has no such row: those stay paused.
 */
const pausedByHostSuspension = sql`coalesce((
  SELECT a.action = 'experience.paused' AND a.details ->> 'via_host_suspension' = 'true'
  FROM audit_log a
  WHERE a.subject_kind = 'experience'
    AND a.subject_id = ${experiences.id}
    AND a.action IN ('experience.paused', 'experience.unpaused')
  ORDER BY a.id DESC
  LIMIT 1
), false)`;

/** The status the latest pause of an experience was made from, which an unpause restores; live when no pause was recorded. */
async function statusBeforePause(
  tx: Transaction,
  experience: LockedExperience,
): Promise<ReturnType<typeof restoredStatus>> {
  const [latest] = await tx
    .select({ from: sql<string | null>`${auditLog.details} ->> 'from_status'` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.subjectKind, 'experience'),
        eq(auditLog.subjectId, experience.id),
        eq(auditLog.action, 'experience.paused'),
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(1);
  return restoredStatus(latest?.from ?? null, experience.linkOutUrl !== null);
}

/**
 * Pauses each locked experience from the status it is in, or unpauses it back to the status its
 * latest pause was made from, one audit row each, and returns the cache changes of the listings
 * guests stop or start seeing. Runs inside the caller's transaction.
 */
async function moveExperiences(
  tx: Transaction,
  userId: string,
  rows: readonly LockedExperience[],
  kind: PauseKind,
  viaHostSuspension: boolean,
): Promise<CacheChange[]> {
  const changes: CacheChange[] = [];
  for (const row of rows) {
    const moved =
      kind === 'pause'
        ? { from: row.status, to: pausedStatus }
        : { from: pausedStatus, to: await statusBeforePause(tx, row) };
    await tx
      .update(experiences)
      .set({ status: moved.to })
      .where(eq(experiences.id, row.id));
    await writeAudit(
      tx,
      experiencePauseEntry(userId, row.id, kind, viaHostSuspension, moved),
    );
    changes.push(...(await placeChanges(tx, row)));
  }
  return changes;
}

/**
 * Pauses an experience guests can see, or unpauses a paused one, back to the status it was paused from, when its host is not suspended. The status
 * check, the status change and the audit row are one transaction, on a locked row, so two ops
 * users acting at once cannot both win. A pause removes the listing from every guest page, and an
 * unpause puts it back, so its cache tags are invalidated after the commit. Runs in a Server
 * Action only.
 */
export async function setExperiencePaused(
  caller: Caller,
  experienceId: string,
  kind: PauseKind,
): Promise<PauseResult> {
  const userId = requireOpsUserId(caller);
  return await withLockedExperience<PauseResult>(
    experienceId,
    { status: 'not_found' },
    async (tx, current) => {
      const refusal = pauseRefusal(
        current.status,
        kind,
        await hostIsSuspended(tx, current.hostId),
      );
      if (refusal) return { result: refusal, changes: [] };
      return {
        result: { status: experienceOutcome(kind) },
        changes: await moveExperiences(tx, userId, [current], kind, false),
      };
    },
  );
}

/**
 * Suspends a host, which pauses every live experience it has, or unsuspends it, which unpauses
 * only the experiences a suspension paused. One transaction: the host row is locked first, so two
 * suspensions of one host queue, then the experiences are locked and moved, each with an audit
 * row, and one host row records the change, with the count. A host with nothing live is still
 * suspended and still recorded, because a suspended host's later approval is refused. Invalidates
 * after the commit. Runs in a Server Action only.
 */
export async function setHostSuspended(
  caller: Caller,
  hostId: string,
  kind: PauseKind,
): Promise<HostPauseResult> {
  const userId = requireOpsUserId(caller);
  return await withLockedHost<HostPauseResult>(
    hostId,
    { status: 'not_found' },
    async (tx, host) => {
      const rows = await tx
        .select()
        .from(experiences)
        .where(
          and(
            eq(experiences.hostId, host.id),
            kind === 'pause'
              ? inArray(experiences.status, [...pausableStatuses])
              : and(
                  eq(experiences.status, pausedStatus),
                  pausedByHostSuspension,
                ),
          ),
        )
        .for('update');
      const changed = hostChanges(
        kind,
        rows.length,
        await hostIsSuspended(tx, host.id),
      );
      if (!changed) {
        return { result: { status: hostOutcome(kind, false) }, changes: [] };
      }
      const changes = await moveExperiences(tx, userId, rows, kind, true);
      await writeAudit(
        tx,
        hostSuspensionEntry(userId, host.id, kind, rows.length),
      );
      return { result: { status: hostOutcome(kind, true) }, changes };
    },
  );
}

/** Whether a host is suspended, how many experiences guests can see a suspension would pause, and how many paused ones it paused. Ops only. */
export async function readHostSuspension(
  caller: Caller,
  hostId: string,
): Promise<HostSuspension> {
  requireOpsUserId(caller);
  const parsedId = WriteIdSchema.safeParse(hostId);
  if (!parsedId.success) return noSuspension;
  const countWhere = async (
    statuses: readonly ExperienceStatus[],
    extra?: SQL,
  ) => {
    const [row] = await dbRead
      .select({ total: count() })
      .from(experiences)
      .where(
        and(
          eq(experiences.hostId, parsedId.data),
          inArray(experiences.status, [...statuses]),
          extra,
        ),
      );
    return row?.total ?? 0;
  };
  const [suspended, liveCount, suspendedCount] = await Promise.all([
    hostIsSuspended(dbRead, parsedId.data),
    countWhere(pausableStatuses),
    countWhere([pausedStatus], pausedByHostSuspension),
  ]);
  return { suspended, liveCount, suspendedCount };
}
