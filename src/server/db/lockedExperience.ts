import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { CacheChange } from '@/lib/cacheTags';
import { WriteIdSchema } from '@/lib/catalog';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { db, type Transaction } from './client';
import { auditLog, experiences, hosts } from './schema';

export type LockedExperience = typeof experiences.$inferSelect;

/**
 * Whether a host is suspended: its latest suspend or unsuspend row in the audit log is a suspend.
 * The host has no status of its own. Read with the host row locked, so a suspension cannot change
 * under the caller.
 */
export async function hostIsSuspended(
  executor: Pick<Transaction, 'select'>,
  hostId: string,
): Promise<boolean> {
  const [latest] = await executor
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.subjectKind, 'host'),
        eq(auditLog.subjectId, hostId),
        inArray(auditLog.action, ['host.suspended', 'host.unsuspended']),
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(1);
  return latest?.action === 'host.suspended';
}

/**
 * Runs `body` in one transaction on a locked experience row, then invalidates the cache changes it
 * returns after the commit, so a body that rolled back invalidates nothing. The experience's host
 * row is locked first and the experience second, the order a host-wide change takes, so the two
 * cannot wait on each other. The host id is read before any lock and is never written after the
 * row is made, so the locked row is re-checked against it. An id that is no experience gives
 * `notFound`. Runs in a Server Action only.
 */
export async function withLockedExperience<R>(
  experienceId: string,
  notFound: R,
  body: (
    tx: Transaction,
    experience: LockedExperience,
  ) => Promise<{ result: R; changes: CacheChange[] }>,
): Promise<R> {
  const parsedId = WriteIdSchema.safeParse(experienceId);
  if (!parsedId.success) return notFound;
  const id = parsedId.data;

  const done = await db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ hostId: experiences.hostId })
      .from(experiences)
      .where(eq(experiences.id, id));
    if (!owner) return { result: notFound, changes: [] };
    await tx
      .select()
      .from(hosts)
      .where(eq(hosts.id, owner.hostId))
      .for('update');
    const [current] = await tx
      .select()
      .from(experiences)
      .where(eq(experiences.id, id))
      .for('update');
    if (current?.hostId !== owner.hostId) {
      return { result: notFound, changes: [] };
    }
    return body(tx, current);
  });
  updateTagsForChanges(done.changes);
  return done.result;
}
