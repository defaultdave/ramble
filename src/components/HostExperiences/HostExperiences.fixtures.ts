import type { HostExperiencesView } from '@/lib/hostExperiences';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const several: HostExperiencesView = {
  rows: [
    {
      id: id(1),
      name: 'Sunset kayak',
      statusLabel: 'Live',
      statusTone: 'success',
      pricesLabel: 'Adult $65 · Child $32.50',
      cancellation: 'Flexible: Free cancellation up to 24 hours before',
      waiver: 'Guests accept a waiver',
    },
    {
      id: id(2),
      name: 'Dawn paddle',
      statusLabel: 'In review',
      statusTone: 'info',
      pricesLabel: 'Adult $40',
      cancellation: 'Strict: Free cancellation up to 3 days before',
      waiver: 'No waiver',
    },
    {
      id: id(3),
      name: 'Harbor history walk',
      statusLabel: 'Paused',
      statusTone: 'warning',
      pricesLabel: 'None set',
      cancellation: 'Flexible: Free cancellation up to 24 hours before',
      waiver: 'No waiver',
    },
  ],
};

export const none: HostExperiencesView = { rows: [] };
