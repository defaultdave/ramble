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
      prices: ['Adult $65', 'Child $32.50'],
      cancellation: 'Flexible: full refund up to 24 hours before',
      waiver: 'Guests accept a waiver',
    },
    {
      id: id(2),
      name: 'Dawn paddle',
      statusLabel: 'In review',
      statusTone: 'info',
      prices: ['Adult $40'],
      cancellation: 'Strict: full refund up to 72 hours before',
      waiver: 'No waiver',
    },
    {
      id: id(3),
      name: 'Harbor history walk',
      statusLabel: 'Paused',
      statusTone: 'warning',
      prices: [],
      cancellation: 'Flexible: full refund up to 24 hours before',
      waiver: 'No waiver',
    },
  ],
};

export const none: HostExperiencesView = { rows: [] };
