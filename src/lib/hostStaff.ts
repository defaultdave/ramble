import type { HostAccess } from './hostAccess';
import type { RoleGrant } from './roleGrants';

// What the host's staff page decides. A host owner gives and takes back one role, read-only staff,
// for their own host; the invite form, notices and mapper are the ones ops staff admin uses.

export const hostStaffPath = '/host/staff';

/** Staff land on the host area after signing in with the link. */
export const hostStaffLandingPath = '/host';

/** The one grant a host owner gives and takes back: read-only staff on their own host. */
export const hostStaffGrant = (hostId: string) =>
  ({ role: 'host_staff', hostId }) as const satisfies RoleGrant;

export type HostStaffRow = { userId: string; email: string };

export type HostStaffResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; rows: readonly HostStaffRow[] };

/** Nobody signed in signs in; anyone who does not own a host, host staff included, is refused. `rows` is null when the caller was not allowed to read them. */
export function hostStaffResult(
  access: HostAccess,
  rows: readonly HostStaffRow[] | null,
): HostStaffResult {
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (access.kind !== 'owner' || rows === null) return { status: 'refused' };
  return { status: 'ok', rows };
}
