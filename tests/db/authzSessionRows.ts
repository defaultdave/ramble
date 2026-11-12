import type { Caller } from '@/server/auth/caller';

// The session-cancellation row of the authorization matrix, kept apart so the matrix file stays under the size limit.
// Cancelling is for good, so the matrix puts this row after every row that still needs a scheduled session.

type Target = { sessionId: string };

/** The module loads when the row runs, not when the row is built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function cancelSessionRows<Rules extends object>(
  sessionRules: Rules,
  ownerA: string,
  staff: readonly string[],
) {
  return [
    {
      fn: 'cancelSession',
      invoke: async (c: Caller, { sessionId }: Target) =>
        (await import('@/server/db/cancelSession')).cancelSession(c, {
          sessionId,
          reason: 'host',
        }),
      allows: { ...sessionRules, allocationOnHostA: [ownerA, ...staff] },
    },
  ];
}
