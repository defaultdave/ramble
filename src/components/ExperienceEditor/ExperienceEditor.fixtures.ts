import {
  buildExperienceChoices,
  newExperienceValues,
  type ExperienceContent,
  type ExperienceEditView,
  type ExperienceListRow,
} from '@/lib/experienceEditor';

const id = (n: number) =>
  `${String(n).padStart(8, '0')}-4b5a-4697-8a9b-0c1d2e3f4a5b`;

export const choices = buildExperienceChoices({
  hosts: [
    { id: id(1), name: 'Clay Corner' },
    { id: id(2), name: 'Spoke & Saddle' },
  ],
  categories: [
    { id: id(3), slug: 'classes', name: 'Classes' },
    { id: id(4), slug: 'tours', name: 'Tours' },
  ],
  neighborhoods: [
    { id: id(5), slug: 'soho', name: 'SoHo' },
    { id: id(6), slug: 'chelsea', name: 'Chelsea' },
  ],
  cancellationTiers: [
    {
      id: id(7),
      key: 'flexible',
      name: 'Flexible',
      fullRefundHoursBefore: 24,
      isDefault: true,
    },
    {
      id: id(8),
      key: 'strict',
      name: 'Strict',
      fullRefundHoursBefore: 168,
      isDefault: false,
    },
  ],
  waivers: [{ id: id(9), title: 'Clay Corner waiver', version: 2 }],
});

export const blankValues: ExperienceContent = newExperienceValues({
  categoryId: '',
  neighborhoodId: '',
  cancellationTierId: id(7),
});

export const savedValues: ExperienceContent = {
  ...blankValues,
  name: 'Wheel throwing night',
  slug: 'wheel-throwing-night',
  description: 'Throw a bowl on the wheel with a teacher beside you.',
  meetingPoint: 'The blue door on Spring Street',
  included: 'Clay, tools and firing',
  accessibilityNotes: 'Step-free entrance',
  durationMinutes: 150,
  categoryId: id(3),
  neighborhoodId: id(5),
  cancellationTierId: id(8),
  outdoor: true,
  weatherPolicy: 'decided_before_start',
  weatherDecisionHours: 6,
  ageRule: 'age_range',
  minAge: 8,
  maxAge: 14,
  taxTreatment: 'taxable',
  waiverRequired: true,
  waiverDocumentId: id(9),
  linkOutUrl: null,
  affiliateUrl: 'https://example.com/clay',
  adultPriceMinor: 8500,
  childPriceMinor: 4050,
  childUsesSpace: false,
};

export const savedView: ExperienceEditView = {
  id: id(20),
  hostId: id(1),
  hostName: 'Clay Corner',
  status: 'live',
  content: savedValues,
};

export const listRows: ExperienceListRow[] = [
  {
    id: id(20),
    name: 'Wheel throwing night',
    status: 'live',
    hostName: 'Clay Corner',
    categoryName: 'Classes',
  },
  {
    id: id(21),
    name: 'Harbour bike ride',
    status: 'draft',
    hostName: 'Spoke & Saddle',
    categoryName: 'Tours',
  },
  {
    id: id(22),
    name: 'Old town walk',
    status: 'paused',
    hostName: 'Spoke & Saddle',
    categoryName: 'Tours',
  },
];

export const nextCursorId = id(22);
