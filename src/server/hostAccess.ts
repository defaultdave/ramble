import { Role, type Caller } from '@/server/auth/caller';

export type HostAccess =
  | { kind: 'signed_out' }
  /** Signed in, but owns no host: a guest, ops, admin, or host staff (who are granted nothing here yet). */
  | { kind: 'not_a_host_owner' }
  | { kind: 'owner'; hostId: string };

/**
 * Which host a request to the host area acts for. The host comes from the caller's own grants and
 * never from the address, so no URL can name another host's data. An owner of several hosts gets
 * the first they were granted (grants are read oldest first).
 */
export function hostAccessFor(caller: Caller): HostAccess {
  if (caller.userId === null) return { kind: 'signed_out' };
  const grant = caller.hostGrants?.find((g) => g.role === Role.HostOwner);
  return grant
    ? { kind: 'owner', hostId: grant.hostId }
    : { kind: 'not_a_host_owner' };
}
