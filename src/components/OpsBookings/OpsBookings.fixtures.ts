import type { OpsBookingDetail, OpsBookingRow } from '@/lib/opsBookings';

export const confirmedRow: OpsBookingRow = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  reference: 'RMB-ABC234',
  status: 'confirmed',
  refundFailedBadge: null,
  guestName: 'Pat Smith',
  email: 'pat@example.com',
  experienceName: 'Pottery for beginners',
  whenLabel: 'Sat, Nov 14 · 2:00 PM EST',
  totalLabel: '$108.00',
  href: '/ops/bookings/0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
};

export const failedRefundRow: OpsBookingRow = {
  ...confirmedRow,
  id: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  reference: 'RMB-XYZ789',
  status: 'cancelled',
  refundFailedBadge: { tone: 'danger', label: 'Refund failed' },
  guestName: 'Sam Lee',
  email: 'sam@example.com',
  href: '/ops/bookings/1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
};

export const confirmedDetail: OpsBookingDetail = {
  row: confirmedRow,
  actions: {
    cancel: {
      label: 'Cancel booking',
      help: 'Cancelling refunds the whole booking to the card.',
      fields: [{ name: 'expectedRefundMinor', value: '10800' }],
    },
    refund: null,
    retryRefund: null,
    resend: {
      label: 'Resend confirmation',
      help: 'Queues the confirmation for the address on the booking.',
      fields: [
        { name: 'resendId', value: '2f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b' },
      ],
    },
    voidLinks: {
      label: 'Void earlier links',
      help: 'Stops every link already emailed from opening this booking.',
      fields: [],
    },
  },
  refundedLabel: '$0.00',
  refunds: [],
  events: [
    { label: 'Booking placed', whenLabel: 'Tue, Nov 10, 10:00 AM EST' },
    { label: 'Booking confirmed', whenLabel: 'Tue, Nov 10, 10:01 AM EST' },
  ],
};

export const failedRefundDetail: OpsBookingDetail = {
  row: failedRefundRow,
  actions: {
    cancel: null,
    refund: null,
    retryRefund: {
      label: 'Retry refund',
      help: 'The last refund failed. This asks the payment provider again for that refund.',
      fields: [],
    },
    resend: null,
    voidLinks: confirmedDetail.actions.voidLinks,
  },
  refundedLabel: '$0.00',
  refunds: [
    {
      id: 'r1',
      amountLabel: '$108.00',
      reasonLabel: 'Guest cancelled',
      statusLabel: 'Failed',
      whenLabel: 'Tue, Nov 10, 11:00 AM EST',
    },
  ],
  events: [
    { label: 'Booking placed', whenLabel: 'Tue, Nov 10, 10:00 AM EST' },
    { label: 'Cancelled by guest', whenLabel: 'Tue, Nov 10, 11:00 AM EST' },
  ],
};

export const cancelledDetail: OpsBookingDetail = {
  ...failedRefundDetail,
  actions: {
    ...failedRefundDetail.actions,
    refund: {
      label: 'Refund $130.00',
      help: 'Sends $130.00, everything this booking still holds, back to the card it was paid with.',
      fields: [{ name: 'expectedRefundMinor', value: '13000' }],
    },
    retryRefund: null,
  },
  refunds: [],
};
