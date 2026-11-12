import 'server-only';
import { hostAccessFor, ownedHostId } from '@/lib/hostAccess';
import { hostStaffResult, type HostStaffResult } from '@/lib/hostStaff';
import { getCaller, type Caller } from '@/server/auth/caller';
import { readHostStaff } from '@/server/db/staffRoles';
import { callerOrLeave } from './opsAccess';

/** The staff of the host the request's caller owns. A failed read propagates, so the host area's error page shows. */
export async function loadHostStaff(): Promise<HostStaffResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const hostId = ownedHostId(access);
  const rows = hostId === null ? null : await readHostStaff(caller, hostId);
  return hostStaffResult(access, rows);
}

/** The caller and the host they own for a Server Action. Anyone else, host staff included, is sent to `leaveTo` before anything is read or changed. */
export function ownerOrLeave(
  leaveTo: string,
): Promise<{ caller: Caller; hostId: string }> {
  return callerOrLeave(async () => {
    const caller = await getCaller();
    const hostId = ownedHostId(hostAccessFor(caller));
    return hostId === null ? null : { caller, hostId };
  }, leaveTo);
}
