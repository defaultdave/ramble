import type { AvailabilitySlotView } from '@/lib/availability';

export const experienceId = '00000000-0000-4000-8000-000000000001';

export const slots: AvailabilitySlotView[] = [
  {
    id: '00000000-0000-4000-8000-000000000011',
    weekdayLabel: 'Tuesday',
    timeLabel: '10:00',
    durationLabel: '90 minutes',
    sourceLabel: 'Ramble sells the host’s own seats',
    allocation: 8,
    upcomingLabel: '12 sessions open, through 2027-02-02',
  },
  {
    id: '00000000-0000-4000-8000-000000000012',
    weekdayLabel: 'Saturday',
    timeLabel: '14:00',
    durationLabel: '120 minutes',
    sourceLabel: 'A block of seats the host’s own system gives Ramble',
    allocation: 4,
    upcomingLabel: 'No upcoming sessions yet',
  },
];
