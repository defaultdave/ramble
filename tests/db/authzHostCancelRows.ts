import type { Caller } from '@/server/auth/caller';

// The host's own cancellation of a booked session, as rows of the authorization matrix. Both
// functions are the owner of the session's host alone: not host staff, not ops or admin (ops cancels
// from its own page), not the other host's owner. The owner of a host also reaches a session whose
// times Ramble sets (an allocation), because cancelling a session is the host's right whatever its
// source. The cancel carries a fingerprint that never matches, so an owner gets `stale` and nothing
// is cancelled; the guard is what the matrix sees.

type Target = { hostId: string; sessionId: string };

const owner = {
  hostA: ['ownerA'],
  hostB: ['ownerB'],
  allocationOnHostA: ['ownerA'],
  missing: [],
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
  ];
}
