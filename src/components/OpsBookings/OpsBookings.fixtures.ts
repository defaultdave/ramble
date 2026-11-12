import type { OpsBookingDetail, OpsBookingRow } from '@/lib/opsBookings';

export const confirmedRow: OpsBookingRow = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  reference: 'RMB-ABC234',
  status: 'confirmed',
  refundFailed: false,
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
  refundFailed: true,
  guestName: 'Sam Lee',
  email: 'sam@example.com',
  href: '/ops/bookings/1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
};

export const confirmedDetail: OpsBookingDetail = {
  row: confirmedRow,
  refundedLabel: '$0.00',
  refunds: [],
  events: [
    { label: 'Booking placed', whenLabel: 'Tue, Nov 10, 10:00 AM EST' },
    { label: 'Booking confirmed', whenLabel: 'Tue, Nov 10, 10:01 AM EST' },
  ],
};

export const failedRefundDetail: OpsBookingDetail = {
  row: failedRefundRow,
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
