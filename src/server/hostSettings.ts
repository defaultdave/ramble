import 'server-only';
import { hostAccessFor } from '@/lib/hostAccess';
import {
  hostSettingsResult,
  type HostSettingsResult,
} from '@/lib/hostSettings';
import { getCaller } from '@/server/auth/caller';
import { readHostSettings } from '@/server/db/hostSettings';

/**
 * The settings of the host the request's caller owns. The host comes from the caller's own grant,
 * never from the address. A failed read propagates, so the host area's error page shows.
 */
export async function loadHostSettings(): Promise<HostSettingsResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const values =
    access.kind === 'owner'
      ? await readHostSettings(caller, access.hostId)
      : null;
  return hostSettingsResult(access, values);
}
