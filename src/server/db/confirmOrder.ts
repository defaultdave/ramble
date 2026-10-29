import 'server-only';
import type { Transaction } from './client';

/** What the provider event job tells the confirm step about the success it is acting on. */
type ConfirmOrderInput = {
  orderId: string;
  attemptId: string;
  providerEventId: string;
  providerPaymentId: string;
  amountMinor: number | null;
  currency: string | null;
  feeMinor: number | null;
  now: Date;
};

type ConfirmOrderResult =
  | { status: 'confirmed' }
  /** The confirm step does not exist yet: the event stays unprocessed and nothing is confirmed. */
  | { status: 'unavailable' };

/**
 * The seam between a provider's success event and `confirmOrder` (design doc 4.2.3). It runs inside
 * the event job's transaction, under the session, hold, and order locks.
 */
export type ConfirmOrder = (
  tx: Transaction,
  input: ConfirmOrderInput,
) => Promise<ConfirmOrderResult>;

// TODO(U-049): replace with confirmOrder, which also checks the amount and takes the refund path.
export const confirmOrder: ConfirmOrder = () =>
  Promise.resolve({ status: 'unavailable' });
