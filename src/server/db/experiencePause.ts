import 'server-only';
import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import type { CacheChange } from '@/lib/cacheTags';
import { WriteIdSchema } from '@/lib/catalog';
import { experiencePauseEntry } from '@/lib/experienceAudit';
import { listingChanges } from '@/lib/experienceEditor';
import {
  pauseRefusal,
  pauseTransitions,
  type HostSuspension,
  type PauseKind,
  type PauseRefusal,
} from '@/lib/experiencePause';
import { hostSuspensionEntry } from '@/lib/hostAudit';
import type { Caller } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { requireOpsUserId, writeAudit } from './audit';
import { db, dbRead, type Transaction } from './client';
import { placeSlugs } from './experienceEditor';
import { experiences, hosts } from './schema';

export type PauseResult =
  { status: 'paused' | 'unpaused' | 'not_found' } | PauseRefusal;

export type HostPauseResult =
  | { status: 'suspended' | 'unsuspended'; changedCount: number }
  | { status: 'not_found' | 'nothing_to_suspend' | 'nothing_to_unsuspend' };

type Locked = typeof experiences.$inferSelect;

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

/**
 * Moves each locked experience to the status `kind` leads to, one audit row each, and returns the
 * cache changes of the listings guests stop or start seeing. Runs inside the caller's transaction.
 */
async function moveExperiences(
  tx: Transaction,
  userId: string,
  rows: readonly Locked[],
  kind: PauseKind,
  viaHostSuspension: boolean,
): Promise<CacheChange[]> {
  const changes: CacheChange[] = [];
  for (const row of rows) {
    await tx
      .update(experiences)
      .set({ status: pauseTransitions[kind].to })
      .where(eq(experiences.id, row.id));
    await writeAudit(
      tx,
      experiencePauseEntry(userId, row.id, kind, viaHostSuspension),
    );
    const place = await placeSlugs(tx, row);
    changes.push(...listingChanges(row.id, place, place));
  }
  return changes;
}

/**
 * Pauses a live experience, or unpauses a paused one. The status check, the status change and the
 * audit row are one transaction, on a locked row, so two ops users acting at once cannot both win.
 * A pause removes the listing from every guest page, and an unpause puts it back, so its cache
 * tags are invalidated after the commit. Runs in a Server Action only.
 */
export async function setExperiencePaused(
  caller: Caller,
  experienceId: string,
  kind: PauseKind,
): Promise<PauseResult> {
  const userId = requireOpsUserId(caller);
  const parsedId = WriteIdSchema.safeParse(experienceId);
  if (!parsedId.success) return { status: 'not_found' };

  const moved = await db.transaction(
    async (tx): Promise<{ result: PauseResult; changes: CacheChange[] }> => {
      const [current] = await tx
        .select()
        .from(experiences)
        .where(eq(experiences.id, parsedId.data))
        .for('update');
      if (!current) return { result: { status: 'not_found' }, changes: [] };
      const refusal = pauseRefusal(current.status, kind);
      if (refusal) return { result: refusal, changes: [] };
      return {
        result: { status: kind === 'pause' ? 'paused' : 'unpaused' },
        changes: await moveExperiences(tx, userId, [current], kind, false),
      };
    },
  );
  // After the commit, so a change that rolled back invalidates nothing.
  updateTagsForChanges(moved.changes);
  return moved.result;
}

/**
 * Suspends a host, which pauses every live experience it has, or unsuspends it, which unpauses
 * only the experiences a suspension paused. One transaction: the host row is locked first, so two
 * suspensions of one host queue, then the experiences are locked and moved, each with an audit row,
 * and one host row says how many. Invalidates after the commit. Runs in a Server Action only.
 */
export async function setHostSuspended(
  caller: Caller,
  hostId: string,
  kind: PauseKind,
): Promise<HostPauseResult> {
  const userId = requireOpsUserId(caller);
  const parsedId = WriteIdSchema.safeParse(hostId);
  if (!parsedId.success) return { status: 'not_found' };

  const moved = await db.transaction(
    async (
      tx,
    ): Promise<{ result: HostPauseResult; changes: CacheChange[] }> => {
      const [host] = await tx
        .select({ id: hosts.id })
        .from(hosts)
        .where(eq(hosts.id, parsedId.data))
        .for('update');
      if (!host) return { result: { status: 'not_found' }, changes: [] };
      const rows = await tx
        .select()
        .from(experiences)
        .where(
          and(
            eq(experiences.hostId, host.id),
            eq(experiences.status, pauseTransitions[kind].from),
            kind === 'unpause' ? pausedByHostSuspension : undefined,
          ),
        )
        .for('update');
      if (rows.length === 0) {
        return {
          result: {
            status:
              kind === 'pause' ? 'nothing_to_suspend' : 'nothing_to_unsuspend',
          },
          changes: [],
        };
      }
      const changes = await moveExperiences(tx, userId, rows, kind, true);
      await writeAudit(
        tx,
        hostSuspensionEntry(userId, host.id, kind, rows.length),
      );
      return {
        result: {
          status: kind === 'pause' ? 'suspended' : 'unsuspended',
          changedCount: rows.length,
        },
        changes,
      };
    },
  );
  updateTagsForChanges(moved.changes);
  return moved.result;
}

/** How many live experiences a suspension would pause, and how many paused ones it paused. Ops only. */
export async function readHostSuspension(
  caller: Caller,
  hostId: string,
): Promise<HostSuspension> {
  requireOpsUserId(caller);
  const countWhere = async (status: 'live' | 'paused', extra?: SQL) => {
    const [row] = await dbRead
      .select({ total: count() })
      .from(experiences)
      .where(
        and(
          eq(experiences.hostId, hostId),
          eq(experiences.status, status),
          extra,
        ),
      );
    return row?.total ?? 0;
  };
  const [liveCount, suspendedCount] = await Promise.all([
    countWhere('live'),
    countWhere('paused', pausedByHostSuspension),
  ]);
  return { liveCount, suspendedCount };
}
