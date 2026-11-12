import 'server-only';
import { orders } from './schema';

/**
 * The order columns the refund arithmetic reads (`RefundableOrder`), selected the same way by every
 * path that judges a refund. A module of its own, so the reads that must stay free of jobs can use it.
 */
export const refundableOrderColumns = {
  status: orders.status,
  ticketSubtotalMinor: orders.ticketSubtotalMinor,
  taxMinor: orders.taxMinor,
  totalMinor: orders.totalMinor,
  amountDueMinor: orders.amountDueMinor,
  commissionMinor: orders.commissionMinor,
  commissionRateBps: orders.commissionRateBps,
  refundedTicketMinor: orders.refundedTicketMinor,
  refundedTaxMinor: orders.refundedTaxMinor,
  commissionReturnedMinor: orders.commissionReturnedMinor,
};
