// The ops landing's at-a-glance counts and recent audit rows.

export const opsDashboardCopy = {
  heading: 'At a glance',
  tiles: {
    review: {
      label: 'Review queue',
      zero: 'Nothing waiting for review',
      one: '1 experience waiting for review',
      many: (count: number) =>
        `${String(count)} experiences waiting for review`,
    },
    refundFailed: {
      label: 'Refunds that failed',
      zero: 'No failed refunds',
      one: '1 booking with a failed refund',
      many: (count: number) => `${String(count)} bookings with a failed refund`,
    },
    support: {
      label: 'Support',
      zero: 'No open requests',
      one: '1 open request',
      many: (count: number) => `${String(count)} open requests`,
    },
    privateRequests: {
      label: 'Private requests',
      zero: 'None received yet',
      one: '1 request received',
      many: (count: number) => `${String(count)} requests received`,
    },
    sessionsToday: {
      label: 'Sessions today',
      zero: 'No sessions today',
      one: '1 session today',
      many: (count: number) => `${String(count)} sessions today`,
    },
  },
  needsAttention: 'Needs attention',
  audit: {
    heading: 'Recent activity',
    link: 'Open the audit log',
    empty: 'Nothing has been recorded yet.',
  },
} as const;
