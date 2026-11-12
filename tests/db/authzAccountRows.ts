import type { Caller } from '@/server/auth/caller';
import { personaKeys } from '@/lib/seed/personas';

// The guest-account row of the authorization matrix, kept apart so the matrix file stays under the size limit.
// Everyone signed in is a guest and reads their own bookings, so every persona is let through and only
// nobody-signed-in is refused. Which bookings come back is tests/db/account-bookings.db.test.ts.

/** The module loads when the row runs, not when the row is built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function accountBookingsRows() {
  return [
    {
      fn: 'readAccountBookings',
      invoke: async (c: Caller) =>
        (await import('@/server/db/accountBookings')).readAccountBookings(
          c,
          new Date(),
        ),
      allows: { platform: personaKeys },
    },
  ];
}
