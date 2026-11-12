import type { Caller } from '@/server/auth/caller';

// The ops session-management rows of the authorization matrix. Every function is ops alone: admin
// and a host owner, the owner of the session's own host included, are refused. Each row acts on
// the session of a seeded host, so the owner of that host is the persona that must be refused.
// The cancel carries a fingerprint that never matches, so an ops caller gets `stale` and nothing is
// cancelled; the guard is what the matrix sees.

type Target = { sessionId: string };

const ops = ['ops'] as const;
const sessionOps = {
  hostA: ops,
  hostB: ops,
  allocationOnHostA: ops,
  missing: ops,
} as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function opsSessionRows() {
  return [
    {
      fn: 'readOpsSessions',
      invoke: async (c: Caller) =>
        (await import('@/server/db/opsSessions')).readOpsSessions(c, {
          when: null,
          term: '',
          cursor: null,
        }),
      allows: { platform: ops },
    },
    {
      fn: 'readOpsSession',
      invoke: async (c: Caller, { sessionId }: Target) =>
        (await import('@/server/db/opsSessions')).readOpsSession(c, sessionId),
      allows: sessionOps,
    },
    {
      fn: 'cancelSessionAsOps',
      invoke: async (c: Caller, { sessionId }: Target) =>
        (await import('@/server/db/opsSessions')).cancelSessionAsOps(c, {
          sessionId,
          reason: 'ramble',
          fingerprint: '0:0:0:0:0',
        }),
      allows: sessionOps,
    },
  ];
}
