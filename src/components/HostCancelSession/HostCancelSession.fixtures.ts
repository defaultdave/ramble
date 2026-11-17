import type { HostCancelView } from '@/lib/hostCancelSession';

export const sessionId = '00000000-0000-4000-8000-000000000002';

export const ready: HostCancelView = {
  id: sessionId,
  title: 'Harbor tour, Sat, Nov 14, 10:00 AM EST',
  whenLabel: 'Sat, Nov 14, 10:00 AM EST',
  experienceName: 'Harbor tour',
  seatsLabel: '4 of 8 seats sold',
  statusLabel: 'Scheduled',
  state: 'ready',
  stateText: null,
  impact: {
    summary:
      '2 bookings refunded in full, $216.00 in all; 1 unpaid order voided; 1 hold released.',
    bookings: [
      { reference: 'RMB-0001', amountLabel: '$108.00' },
      { reference: 'RMB-0002', amountLabel: '$108.00' },
    ],
    moreLabel: null,
    blockedText: null,
    fingerprint: '2:21600:1:2:1:0',
  },
};

export const blocked: HostCancelView = {
  ...ready,
  state: 'blocked',
  stateText:
    'This session cannot be cancelled here. Contact Ramble support and they will cancel it for you.',
  impact: {
    ...ready.impact,
    blockedText:
      'This cannot be cancelled here: RMB-0003 paid in part by a gift.',
  },
};

export const cancelled: HostCancelView = {
  ...ready,
  statusLabel: 'Cancelled',
  state: 'cancelled',
  stateText: 'This session is cancelled. Its guests were refunded and told.',
  impact: {
    summary:
      '0 bookings refunded in full, $0.00 in all; 0 unpaid orders voided; 0 holds released.',
    bookings: [],
    moreLabel: null,
    blockedText: null,
    fingerprint: '0:0:0:0:0:0',
  },
};
