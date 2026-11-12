import 'server-only';
import { hostAccessFor } from '@/lib/hostAccess';
import {
  hostExperiencesResult,
  type HostExperiencesResult,
} from '@/lib/hostExperiences';
import { getCaller } from '@/server/auth/caller';
import { listHostExperiences } from '@/server/db/catalog';

/**
 * The experiences of the host the request's caller owns, in every status. The host comes from the
 * caller's own grant, never from the address. A failed read propagates, so the host area's error
 * page shows instead of a list that could be missing an experience.
 */
export async function loadHostExperiences(): Promise<HostExperiencesResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const experiences =
    access.kind === 'owner'
      ? await listHostExperiences(caller, access.hostId)
      : null;
  return hostExperiencesResult(access, experiences);
}
