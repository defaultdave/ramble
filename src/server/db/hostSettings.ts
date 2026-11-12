import 'server-only';
import { eq } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import {
  hostSettingsChanges,
  type HostSettingsSaveResult,
} from '@/lib/hostSettings';
import {
  changedHostSettings,
  hostSaveOutcome,
  type HostSettingsInput,
} from '@/lib/hostSetup';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { db } from './client';
import { saveHostFields } from './hostFields';
import { withLockedHost } from './lockedExperience';
import { experiences, hosts } from './schema';

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
 * locked, and the change and its audit row are one transaction (`saveHostFields`). A new name or
 * about text invalidates the host page and the host's experiences after the commit
 * (`hostSettingsChanges`). Runs in a Server Action only.
 */
export async function updateHostSettings(
  caller: Caller,
  hostId: string,
  input: HostSettingsInput,
): Promise<HostSettingsSaveResult> {
  const id = EntityIdSchema.parse(hostId);
  requireRole(caller, Role.HostOwner, { hostId: id });
  return withLockedHost<HostSettingsSaveResult>(
    id,
    'not_found',
    async (tx, host) => {
      const changed = await saveHostFields(
        tx,
        caller,
        Role.HostOwner,
        host.id,
        input,
        (current) => changedHostSettings(current, input),
      );
      if (changed === null) return { result: 'not_found', changes: [] };
      const result = hostSaveOutcome(changed);
      if (result === 'unchanged') return { result, changes: [] };
      const owned = await tx
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.hostId, host.id));
      return {
        result,
        changes: hostSettingsChanges(
          changed,
          owned.map(({ id }) => id),
        ),
      };
    },
  );
}
