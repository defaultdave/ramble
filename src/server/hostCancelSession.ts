import 'server-only';
import { hostAreaResult } from '@/lib/hostAccess';
import {
  buildHostCancelView,
  type HostCancelView,
} from '@/lib/hostCancelSession';
import { parseIdField } from '@/lib/opsForm';
import { readHostSessionCancel } from '@/server/db/hostCancelSession';
import { loadForHostArea } from './hostArea';

export type HostCancelResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostCancelView };

/**
 * The cancel page's session, for the host the caller owns (staff are refused: only an owner cancels).
 * A session id that is no id, is missing, or is another host's is refused the same way, so the
 * address never says which sessions exist. A failed read propagates, so the host area's error page shows.
 */
export function loadHostCancel(
  rawSessionId: string,
): Promise<HostCancelResult> {
  const sessionId = parseIdField(rawSessionId);
  return loadForHostArea(
    (caller, hostId) =>
      sessionId === null
        ? Promise.resolve(null)
        : readHostSessionCancel(caller, hostId, sessionId),
    (access, data) =>
      hostAreaResult(access, data, (read) => ({
        status: 'ok' as const,
        view: buildHostCancelView(read),
      })),
  );
}
