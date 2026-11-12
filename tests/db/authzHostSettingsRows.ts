import type { Caller } from '@/server/auth/caller';

// The host settings rows of the authorization matrix, kept apart so the matrix file stays under the
// size limit. Each function is the owner of the host alone, checked against the host of the row:
// the owner of the other host, host staff, a guest, ops, admin, and nobody are refused.

type Target = { hostId: string };

const ownerOfTheHost = {
  hostA: ['ownerA'],
  hostB: ['ownerB'],
  missing: [],
} as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function hostSettingsRows() {
  const settings = () => import('@/server/db/hostSettings');
  return [
    {
      fn: 'readHostSettings',
      invoke: async (c, t) => (await settings()).readHostSettings(c, t.hostId),
      allows: ownerOfTheHost,
    },
    {
      fn: 'updateHostSettings',
      invoke: async (c, t) =>
        (await settings()).updateHostSettings(c, t.hostId, {
          name: 'Matrix settings host',
          description: null,
          notificationEmail: null,
        }),
      allows: ownerOfTheHost,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller, target: Target) => Promise<unknown>;
    allows: Partial<Record<string, readonly string[]>>;
  }[];
}
