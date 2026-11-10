import type { HostDashboardData, HostDashboardView } from './hostDashboard';
import { buildHostDashboard } from './hostDashboard';

/** What the host area needs to know about a caller; the server's `Caller` fits it. */
export type HostAccessInput = {
  /** Null when nobody is signed in. */
  userId: string | null;
  hostGrants?: readonly { role: string; hostId: string }[] | undefined;
};

/** `not_a_host_owner` is signed in but owns no host: a guest, ops, admin, or host staff (who are granted nothing here yet). */
export type HostAccess =
  | { kind: 'signed_out' }
  | { kind: 'not_a_host_owner' }
  | { kind: 'owner'; hostId: string };

/**
 * Which host a request to the host area acts for. The host comes from the caller's own grants and
 * never from the address, so no URL can name another host's data. An owner of several hosts gets
 * the first they were granted (grants are read oldest first).
 */
export function hostAccessFor(caller: HostAccessInput): HostAccess {
  if (caller.userId === null) return { kind: 'signed_out' };
  const grant = caller.hostGrants?.find((g) => g.role === 'host_owner');
  return grant
    ? { kind: 'owner', hostId: grant.hostId }
    : { kind: 'not_a_host_owner' };
}

export type HostDashboardResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostDashboardView };

/**
 * What the page does with a request: nobody signed in is told to sign in; anyone else who is not a
 * host owner is refused, as is an owner whose host no longer exists (`data` null).
 */
export function hostDashboardResult(
  access: HostAccess,
  data: HostDashboardData | null,
): HostDashboardResult {
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (access.kind === 'not_a_host_owner' || data === null) {
    return { status: 'refused' };
  }
  return { status: 'ok', view: buildHostDashboard(data) };
}
