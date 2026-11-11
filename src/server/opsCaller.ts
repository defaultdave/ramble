import 'server-only';
import { anonymousCaller, getCaller, type Caller } from '@/server/auth/caller';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';

/**
 * The caller for an ops page and its nav. A caller that cannot be read is anonymous, never ops: a
 * failure grants no role, and the page still offers the tester's way in with the shared secret.
 */
export async function readOpsCaller(): Promise<Caller> {
  try {
    return await getCaller();
  } catch (error) {
    rethrowOrLog('The caller could not be read for the ops area', error);
    return anonymousCaller;
  }
}
