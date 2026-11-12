import type { Caller } from '@/server/auth/caller';

// The capacity and pause rows of the authorization matrix. Both functions are ops alone: admin and
// a host owner, the owner of the session's own host included, are refused. The capacity change
// carries a version no session has, and the pause a fingerprint that never matches, so an ops
// caller gets a refusal result and nothing is changed; the guard is what the matrix sees.

type Target = { sessionId: string };

const ops = ['ops'] as const;
const sessionOps = {
  hostA: ops,
  hostB: ops,
  allocationOnHostA: ops,
  missing: ops,
} as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function opsSessionChangeRows() {
  return [
    {
      fn: 'changeAllocationAsOps',
      invoke: async (c: Caller, { sessionId }: Target) =>
        (await import('@/server/db/opsSessions')).changeAllocationAsOps(c, {
          sessionId,
          allocation: 8,
          expectedVersion: 999,
        }),
      allows: sessionOps,
    },
    {
      fn: 'pauseExperienceAndCancel',
      invoke: async (c: Caller, { sessionId }: Target) =>
        (await import('@/server/db/opsSessions')).pauseExperienceAndCancel(c, {
          sessionId,
          fingerprint: '9:9:9:9:9:9',
        }),
      allows: sessionOps,
    },
  ];
}
