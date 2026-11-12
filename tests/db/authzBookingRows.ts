import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/auth/caller';

// The ops-bookings read rows of the authorization matrix. Both functions are ops alone; a missing
// booking answers null to ops and is refused to everyone else before anything is read.

const opsOnly = { platform: ['ops'] } as const;

/** The modules load when a row runs, not when the rows are built: they read DATABASE_URL, which the matrix's beforeAll sets. */
export function opsBookingRows() {
  return [
    {
      fn: 'readOpsBookings',
      invoke: async (c) =>
        (await import('@/server/db/opsBookings')).readOpsBookings(c, {
          search: { kind: 'none' },
          filter: null,
          cursor: null,
        }),
      allows: opsOnly,
    },
    {
      fn: 'readOpsBooking',
      invoke: async (c) =>
        (await import('@/server/db/opsBookings')).readOpsBooking(
          c,
          randomUUID(),
        ),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
