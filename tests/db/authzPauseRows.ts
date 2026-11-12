import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/auth/caller';

// The pause and suspension rows of the authorization matrix, kept apart so the matrix file stays
// under the size limit. Every function here is ops alone. The experience and the host suspended
// are ones that do not exist, so an ops caller is let through the guard and finds nothing to
// change (the matrix's own hosts are left alone), and every other subject is refused.

type Target = { hostId: string; experienceId: string };

const opsOnly = { platform: ['ops'] } as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function experiencePauseRows() {
  const pause = () => import('@/server/db/experiencePause');
  return [
    {
      fn: 'setExperiencePaused',
      invoke: async (c, t) =>
        (await pause()).setExperiencePaused(c, t.experienceId, 'pause'),
      allows: opsOnly,
    },
    {
      fn: 'setHostSuspended',
      invoke: async (c) =>
        (await pause()).setHostSuspended(c, randomUUID(), 'pause'),
      allows: opsOnly,
    },
    {
      fn: 'readHostSuspension',
      invoke: async (c, t) => (await pause()).readHostSuspension(c, t.hostId),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller, target: Target) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
