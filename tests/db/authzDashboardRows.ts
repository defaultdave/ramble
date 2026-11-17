import type { Caller } from '@/server/auth/caller';

// The ops-landing rows of the authorization matrix: five counts and the latest audit rows, every one ops alone.

const opsOnly = { platform: ['ops'] } as const;

/** The modules load when a row runs, not when the rows are built: they read DATABASE_URL, which the matrix's beforeAll sets. */
export function opsDashboardRows() {
  return [
    {
      fn: 'countExperiencesInReview',
      invoke: async (c) =>
        (await import('@/server/db/opsDashboard')).countExperiencesInReview(c),
      allows: opsOnly,
    },
    {
      fn: 'countRefundFailedBookings',
      invoke: async (c) =>
        (await import('@/server/db/opsDashboard')).countRefundFailedBookings(c),
      allows: opsOnly,
    },
    {
      fn: 'countOpenSupportRequests',
      invoke: async (c) =>
        (await import('@/server/db/opsDashboard')).countOpenSupportRequests(c),
      allows: opsOnly,
    },
    {
      fn: 'countSessionsToday',
      invoke: async (c) =>
        (await import('@/server/db/opsDashboard')).countSessionsToday(c),
      allows: opsOnly,
    },
    {
      fn: 'readRecentAuditForOps',
      invoke: async (c) =>
        (await import('@/server/db/opsDashboard')).readRecentAuditForOps(c, 5),
      allows: opsOnly,
    },
    {
      fn: 'countOpsPrivateRequests',
      invoke: async (c) =>
        (await import('@/server/db/privateRequests')).countOpsPrivateRequests(
          c,
        ),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
