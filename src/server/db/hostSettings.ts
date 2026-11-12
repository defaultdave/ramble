import 'server-only';
import { eq } from 'drizzle-orm';
import type { CacheChange } from '@/lib/cacheTags';
import { EntityIdSchema } from '@/lib/catalog';
import { hostUpdatedEntry } from '@/lib/hostAudit';
import { changedHostSettings, type HostSettingsInput } from '@/lib/hostSetup';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { requireUserId, writeAudit } from './audit';
import { db } from './client';
import { withLockedHost } from './lockedExperience';
import { experiences, hosts } from './schema';

export type UpdateHostSettingsResult = 'updated' | 'unchanged' | 'not_found';

/** The settings of the host the caller owns, or null when the host is gone. The caller is checked against `hostId` before anything is read. */
export async function readHostSettings(
  caller: Caller,
  hostId: string,
): Promise<HostSettingsInput | null> {
  const id = EntityIdSchema.parse(hostId);
  requireRole(caller, Role.HostOwner, { hostId: id });
  // The primary, not a replica: the page that follows a save must show it.
  const [host] = await db
    .select({
      name: hosts.name,
      description: hosts.description,
      notificationEmail: hosts.notificationEmail,
    })
    .from(hosts)
    .where(eq(hosts.id, id));
  return host ?? null;
}

/**
 * Saves the name, about text and notice address of the host the caller owns. The host row is
 * locked, the change and its audit row are one transaction, and nothing differing writes nothing,
 * audit row included. A new name or about text is shown on the host page and on every experience
 * of the host, so those caches are invalidated after the commit; a new notice address is shown to
 * no guest. Runs in a Server Action only.
 */
export async function updateHostSettings(
  caller: Caller,
  hostId: string,
  input: HostSettingsInput,
): Promise<UpdateHostSettingsResult> {
  requireRole(caller, Role.HostOwner, { hostId });
  const userId = requireUserId(caller, Role.HostOwner);
  return withLockedHost<UpdateHostSettingsResult>(
    hostId,
    'not_found',
    async (tx, host) => {
      const [current] = await tx
        .select({
          name: hosts.name,
          description: hosts.description,
          notificationEmail: hosts.notificationEmail,
        })
        .from(hosts)
        .where(eq(hosts.id, host.id));
      if (!current) return { result: 'not_found', changes: [] };
      const changed = changedHostSettings(current, input);
      if (changed.length === 0) return { result: 'unchanged', changes: [] };
      await tx.update(hosts).set(input).where(eq(hosts.id, host.id));
      await writeAudit(tx, hostUpdatedEntry(userId, host.id, changed));
      const shownToGuests =
        changed.includes('name') || changed.includes('description');
      const changes: CacheChange[] = [];
      if (shownToGuests) {
        const owned = await tx
          .select({ id: experiences.id })
          .from(experiences)
          .where(eq(experiences.hostId, host.id));
        changes.push(
          { kind: 'hostProfile' },
          ...owned.map(({ id }): CacheChange => ({
            kind: 'experience',
            experienceId: id,
          })),
        );
      }
      return { result: 'updated', changes };
    },
  );
}
