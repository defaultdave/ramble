import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/auth/caller';

// The ops-bookings action rows of the authorization matrix. Every function is ops alone; a missing
// booking answers not found to ops and is refused to everyone else before anything is read or written.

const opsOnly = { platform: ['ops'] } as const;

/** The modules load when a row runs, not when the rows are built: they read DATABASE_URL, which the matrix's beforeAll sets. */
export function opsBookingActionRows() {
  return [
    {
      fn: 'cancelBookingAsOps',
      invoke: async (c) =>
        (await import('@/server/db/opsBookings')).cancelBookingAsOps(c, {
          orderId: randomUUID(),
          expectedRefundMinor: 0,
        }),
      allows: opsOnly,
    },
    {
      fn: 'refundBookingAsOps',
      invoke: async (c) =>
        (await import('@/server/db/opsBookings')).refundBookingAsOps(c, {
          orderId: randomUUID(),
          expectedRefundMinor: 0,
        }),
      allows: opsOnly,
    },
    {
      fn: 'voidBookingLinks',
      invoke: async (c) =>
        (await import('@/server/db/opsBookings')).voidBookingLinks(
          c,
          randomUUID(),
        ),
      allows: opsOnly,
    },
    {
      fn: 'retryFailedRefund',
      invoke: async (c) =>
        (await import('@/server/db/orderRefundRetry')).retryFailedRefund(
          c,
          randomUUID(),
        ),
      allows: opsOnly,
    },
    {
      fn: 'resendBookingConfirmation',
      invoke: async (c) =>
        (await import('@/server/db/opsBookings')).resendBookingConfirmation(c, {
          orderId: randomUUID(),
          resendId: randomUUID(),
        }),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
