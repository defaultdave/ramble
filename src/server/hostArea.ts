import 'server-only';
import {
  hostAccessFor,
  readableHostId,
  type HostAccess,
} from '@/lib/hostAccess';
import { getCaller, type Caller } from '@/server/auth/caller';

/**
 * What every host page loads: the request's caller, the host their own grant names (never one from
 * the address), and what `read` finds for that host, read only for an owner, or for staff too when
 * `allowStaff` is set (the dashboard; settings and the experience list are an owner's). `decide` turns the
 * access and what was read into the page's result. A failed read propagates, so the host area's
 * error page shows instead of a page that could be missing rows.
 */
export async function loadForHostArea<Data, Result>(
  read: (caller: Caller, hostId: string) => Promise<Data | null>,
  decide: (access: HostAccess, data: Data | null) => Result,
  allowStaff = false,
): Promise<Result> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const hostId = allowStaff
    ? readableHostId(access)
    : access.kind === 'owner'
      ? access.hostId
      : null;
  const data = hostId === null ? null : await read(caller, hostId);
  return decide(access, data);
}
