// The ops landing's at-a-glance counts and recent audit rows.

export const opsDashboardCopy = {
  heading: 'At a glance',
  tiles: {
    review: {
      label: 'Review queue',
      zero: 'Nothing waiting for review',
      noun: 'experience',
      plural: 'experiences',
      suffix: ' waiting for review',
    },
    refundFailed: {
      label: 'Refunds that failed',
      zero: 'No failed refunds',
      noun: 'booking',
      plural: 'bookings',
      suffix: ' with a failed refund',
    },
    support: {
      label: 'Support',
      zero: 'No open requests',
      noun: 'open request',
      plural: 'open requests',
      suffix: '',
    },
    privateRequests: {
      label: 'Private requests',
      zero: 'None received yet',
      noun: 'request',
      plural: 'requests',
      suffix: ' received',
    },
    sessionsToday: {
      label: 'Sessions today',
      zero: 'No sessions today',
      noun: 'session',
      plural: 'sessions',
      suffix: ' today',
    },
  },
  needsAttention: 'Needs attention',
  audit: {
    heading: 'Recent activity',
    link: 'Open the audit log',
    empty: 'Nothing has been recorded yet.',
  },
} as const;
