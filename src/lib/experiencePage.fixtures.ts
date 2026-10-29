import type { GuestExperience } from './catalog';

export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** An ID with hex letters, so a test of lower-casing has something to change. */
export const idWithLetters = '0000000a-0000-4000-8000-00000000000b';

/** A live, outdoor, bookable experience with every field a guest page reads. */
export const experience = (
  overrides: Partial<GuestExperience> = {},
): GuestExperience => ({
  id: id(1),
  hostId: id(2),
  categoryId: id(3),
  neighborhoodId: id(4),
  cancellationTierId: id(5),
  slug: 'sunset-kayak',
  name: 'Sunset kayak on the Hudson',
  description: 'Paddle out as the light goes gold.',
  meetingPoint:
    'Pier 26 boathouse, Tribeca. The exact door is in your confirmation.',
  included: 'Kayak, paddle, and life jacket',
  durationMinutes: 120,
  accessibilityNotes: "There's a ramp down to the dock.",
  status: 'live',
  outdoor: true,
  weatherPolicy: 'decided_before_start',
  weatherDecisionHours: 3,
  ageRule: 'minimum_age',
  minAge: 14,
  maxAge: null,
  waiverRequired: false,
  linkOutUrl: null,
  affiliateUrl: null,
  host: {
    id: id(2),
    slug: 'hudson-paddle-club',
    name: 'Hudson Paddle Club',
    description: 'Six guides, all trained in water rescue.',
  },
  priceOptions: [
    {
      id: id(6),
      experienceId: id(1),
      kind: 'adult',
      priceMinor: 6500,
      usesSpace: true,
    },
  ],
  cancellationTier: {
    id: id(5),
    key: 'flexible',
    name: 'Flexible',
    fullRefundHoursBefore: 24,
    isDefault: true,
  },
  ...overrides,
});

export const place = {
  category: { slug: 'outdoors', name: 'Outdoors' },
  neighborhood: { slug: 'tribeca', name: 'Tribeca' },
};
