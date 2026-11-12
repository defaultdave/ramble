import type { SupportQueueRow } from '@/lib/supportQueue';

export const openRow: SupportQueueRow = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  name: 'Pat Smith',
  email: 'pat@example.com',
  reason: 'A refund or payment',
  message: 'I was charged twice for the same booking.\nPlease check.',
  receivedLabel: 'Mon, Nov 9, 10:30 AM EST',
  status: 'open',
  resolution: null,
};

export const resolvedRow: SupportQueueRow = {
  id: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  name: 'Sam Lee',
  email: 'sam@example.com',
  reason: 'Accessibility',
  message: 'Is the studio step free?',
  receivedLabel: 'Sun, Nov 8, 9:00 AM EST',
  status: 'resolved',
  resolution: {
    note: 'Replied by phone: yes, step free.',
    whenLabel: 'Mon, Nov 9, 1:00 PM EST',
  },
};
