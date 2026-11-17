import type { Caller } from '@/server/auth/caller';

// The host's own cancellation of a booked session, as rows of the authorization matrix. Both
// functions are the owner of the session's host alone: not host staff, not ops or admin (ops cancels
// from its own page), not the other host's owner. The owner of a host also reaches a session whose
// times Ramble sets (an allocation), because cancelling a session is the host's right whatever its
// source. The cancel carries a fingerprint that never matches, so an owner gets `stale` and nothing
// is cancelled; the guard is what the matrix sees. The two reads they share (`readImpact` and
// `readReleasableHolds`) are rows too: ops and admin read any session, an owner only through their host.

type Target = { hostId: string; sessionId: string };

const owner = {
  hostA: ['ownerA'],
  hostB: ['ownerB'],
  allocationOnHostA: ['ownerA'],
  missing: [],
} as const;

/** The shared impact reads admit ops and admin on any session, and a host owner only through their own host. */
const impactReader = {
  hostA: ['ownerA', 'ops', 'admin'],
  hostB: ['ownerB', 'ops', 'admin'],
  allocationOnHostA: ['ownerA', 'ops', 'admin'],
  missing: ['ops', 'admin'],
} as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function hostCancelRows() {
  return [
    {
      fn: 'readHostSessionCancel',
      invoke: async (c: Caller, { hostId, sessionId }: Target) =>
        (await import('@/server/db/hostCancelSession')).readHostSessionCancel(
          c,
          hostId,
          sessionId,
        ),
      allows: owner,
    },
    {
      fn: 'cancelSessionAsHost',
      invoke: async (c: Caller, { hostId, sessionId }: Target) =>
        (await import('@/server/db/hostCancelSession')).cancelSessionAsHost(
          c,
          hostId,
          { sessionId, fingerprint: '9:9:9:9:9:9' },
        ),
      allows: owner,
    },
    {
      fn: 'readImpact',
      invoke: async (c: Caller, { hostId, sessionId }: Target) => {
        const { readImpact } = await import('@/server/db/sessionImpact');
        const { db } = await import('@/server/db/client');
        return readImpact(c, { hostId }, db, [sessionId], new Date());
      },
      allows: impactReader,
    },
    {
      fn: 'readReleasableHolds',
      invoke: async (c: Caller, { hostId, sessionId }: Target) => {
        const { readReleasableHolds } =
          await import('@/server/db/sessionImpact');
        const { db } = await import('@/server/db/client');
        return readReleasableHolds(c, { hostId }, db, [sessionId]);
      },
      allows: impactReader,
    },
  ];
}
