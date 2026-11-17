import type { OpsRequestRow } from '@/lib/opsRequests';

export const shortRow: OpsRequestRow = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  experienceName: 'Pottery wheel night',
  requestedLabel: 'Saturday, November 21, 2026',
  groupLabel: '12 guests',
  budgetLabel: '$1,200',
  name: 'Pat Smith',
  email: 'pat@example.com',
  message: { preview: 'A birthday for the whole team.', full: null },
  receivedLabel: 'Mon, Nov 9, 10:30 AM EST',
};

export const longRow: OpsRequestRow = {
  ...shortRow,
  id: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  name: 'Sam Lee',
  email: 'sam@example.com',
  message: {
    preview: 'We would like the studio to ourselves for a long afternoon…',
    full: 'We would like the studio to ourselves for a long afternoon.\nPlease tell us what the room holds.',
  },
  receivedLabel: 'Sun, Nov 8, 9:00 AM EST',
};

export const noMessageRow: OpsRequestRow = {
  ...shortRow,
  id: '2b2e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  name: 'Kim Wu',
  email: 'kim@example.com',
  message: null,
};
