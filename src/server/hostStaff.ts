import 'server-only';
import { hostAccessFor } from '@/lib/hostAccess';
import { hostStaffResult, type HostStaffResult } from '@/lib/hostStaff';
import { getCaller } from '@/server/auth/caller';
import { readHostStaff } from '@/server/db/staffRoles';

/** The staff of the host the request's caller owns. A failed read propagates, so the host area's error page shows. */
export async function loadHostStaff(): Promise<HostStaffResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const rows =
    access.kind === 'owner' ? await readHostStaff(caller, access.hostId) : null;
  return hostStaffResult(access, rows);
}
