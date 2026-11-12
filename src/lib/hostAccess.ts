import type { HostDashboardData, HostDashboardView } from './hostDashboard';
import { buildHostDashboard } from './hostDashboard';

/** What the host area needs to know about a caller; the server's `Caller` fits it. */
export type HostAccessInput = {
  /** Null when nobody is signed in. */
  userId: string | null;
  hostGrants?: readonly { role: string; hostId: string }[] | undefined;
};

/** `no_host_role` is signed in but holds no role on any host: a guest, ops, or admin. Host staff read one host and change nothing. */
export type HostAccess =
  | { kind: 'signed_out' }
  | { kind: 'no_host_role' }
  | { kind: 'owner'; hostId: string }
  | { kind: 'staff'; hostId: string };

/** The host a caller may read, whichever host role they hold; null for none. */
export function readableHostId(access: HostAccess): string | null {
  return access.kind === 'owner' || access.kind === 'staff'
    ? access.hostId
    : null;
}

/** The host a caller owns, which only an owner may manage (sessions, staff); null for staff and everyone else. */
export function ownedHostId(access: HostAccess): string | null {
  return access.kind === 'owner' ? access.hostId : null;
}

/**
 * Which host a request to the host area acts for. The host comes from the caller's own grants and
 * never from the address, so no URL can name another host's data. An owner of several hosts gets
 * the first they were granted (grants are read oldest first). An owner of one host and staff of
 * another gets the owned host.
 */
export function hostAccessFor(caller: HostAccessInput): HostAccess {
  if (caller.userId === null) return { kind: 'signed_out' };
  const owned = caller.hostGrants?.find((g) => g.role === 'host_owner');
  if (owned) return { kind: 'owner', hostId: owned.hostId };
  const staffed = caller.hostGrants?.find((g) => g.role === 'host_staff');
  return staffed
    ? { kind: 'staff', hostId: staffed.hostId }
    : { kind: 'no_host_role' };
}

export type HostDashboardResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostDashboardView; canManage: boolean };

/**
 * What the page does with a request: nobody signed in is told to sign in; anyone else with no host
 * role is refused, as is one whose host no longer exists (`data` null). Only an owner may manage.
 */
export function hostDashboardResult(
  access: HostAccess,
  data: HostDashboardData | null,
): HostDashboardResult {
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (access.kind === 'no_host_role' || data === null) {
    return { status: 'refused' };
  }
  return {
    status: 'ok',
    view: buildHostDashboard(data),
    canManage: ownedHostId(access) !== null,
  };
}
