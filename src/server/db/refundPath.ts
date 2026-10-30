import 'server-only';
import type { RefundPathReason } from '@/lib/confirmOrder';
import type { Transaction } from './client';

type RefundPathInput = {
  orderId: string;
  attemptId: string;
  providerPaymentId: string;
  amountMinor: number | null;
  currency: string | null;
  reason: RefundPathReason;
  at: Date;
};

/**
 * Where a payment goes that cannot be confirmed (design doc 4.2.3, step 5): the order is refunded
 * after the lapse, the hold released, a full refund requested, and the guest told. It runs inside
 * the confirm step's transaction, under its locks. `unavailable` leaves the order and the payment
 * as they were, so the provider event is retried instead of any refund state being guessed.
 */
export type TakeRefundPath = (
  tx: Transaction,
  input: RefundPathInput,
) => Promise<{ status: 'unavailable' }>;

// TODO(U-109): replace with the refund path, which also reads `paidAfterLapseData` for the email.
export const takeRefundPath: TakeRefundPath = () =>
  Promise.resolve({ status: 'unavailable' });
