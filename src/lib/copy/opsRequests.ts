// The ops private-requests queue: the page, its table and its empty state.

export const opsRequestsCopy = {
  nav: {
    label: 'Private requests',
    summary: 'Read guests’ requests for a private session of an experience.',
  },
  title: 'Private requests',
  caption: 'Private requests',
  columns: {
    received: 'Received',
    experience: 'Experience',
    requestedDate: 'Requested date',
    groupSize: 'Group',
    budget: 'Budget',
    from: 'From',
    message: 'Message',
  },
  noMessage: 'No message',
  empty: {
    title: 'No private requests',
    body: 'Requests sent from an experience page appear here.',
  },
} as const;
