import type { TaxonomyFixture } from '../types';

// ADR 0008: eight categories from the brief's host mix, six Brooklyn and Manhattan neighborhoods.
export const categories: TaxonomyFixture[] = [
  { slug: 'ceramics-and-crafts', name: 'Ceramics and crafts' },
  { slug: 'cooking', name: 'Cooking' },
  { slug: 'walking-tours', name: 'Walking tours' },
  { slug: 'wine-and-cocktails', name: 'Wine and cocktails' },
  { slug: 'food-and-coffee', name: 'Food and coffee' },
  { slug: 'outdoors', name: 'Outdoors' },
  { slug: 'wellness', name: 'Wellness' },
  { slug: 'kids', name: 'Kids' },
];

export const neighborhoods: TaxonomyFixture[] = [
  { slug: 'williamsburg', name: 'Williamsburg' },
  { slug: 'carroll-gardens', name: 'Carroll Gardens' },
  { slug: 'park-slope', name: 'Park Slope' },
  { slug: 'sunset-park', name: 'Sunset Park' },
  { slug: 'tribeca', name: 'Tribeca' },
  { slug: 'lower-east-side', name: 'Lower East Side' },
];
