import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/auth/caller';

// The support-queue rows of the authorization matrix. Both functions are ops alone; a missing
// request answers not found to ops and is refused to everyone else.

const opsOnly = { platform: ['ops'] } as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function supportQueueRows() {
  return [
    {
      fn: 'readSupportQueue',
      invoke: async (c) =>
        (await import('@/server/db/supportQueue')).readSupportQueue(c, {
          status: null,
          cursor: null,
        }),
      allows: opsOnly,
    },
    {
      fn: 'resolveSupportRequest',
      invoke: async (c) =>
        (await import('@/server/db/supportQueue')).resolveSupportRequest(c, {
          id: randomUUID(),
          note: 'Matrix note',
        }),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
