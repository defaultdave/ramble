import { maxScaleExperiences, type ScaleOptions } from './args';
import { createRandom, type Random } from './ids';
import { categories, neighborhoods } from './fixtures/taxonomy';
import type {
  ExperienceFixture,
  HostFixture,
  PriceFixture,
  ScaleFixtures,
  SlotFixture,
} from './types';

// The scale fixture (ADR 0008): about 150 hosts and 400 experiences with plausible variety, for
// staging and load tests. It reuses the curated categories and neighborhoods, and everything it
// makes follows from the options, so a run is repeatable and a count bounds the rows it writes.

const hostsPerExperience = 150 / 400;

const hostFirstWords = [
  'Maple',
  'Harbor',
  'Linden',
  'Copper',
  'Brass',
  'Juniper',
  'Willow',
  'Granite',
  'Cedar',
  'Marigold',
  'Tidewater',
  'Sparrow',
  'Lantern',
  'Fable',
  'Orchard',
  'Foxglove',
  'Atlas',
  'Bramble',
  'Cobble',
  'Driftwood',
  'Ember',
  'Fern',
  'Gable',
  'Hollow',
  'Ivy',
];

const hostSecondWords = [
  'Studio',
  'Kitchen',
  'Collective',
  'Workshop',
  'Club',
  'House',
  'Lab',
  'Works',
  'Guild',
  'Table',
  'Room',
  'Yard',
  'Society',
  'Outfit',
  'Press',
  'Cellar',
];

/** How many distinct host names the two word lists make. It is the most hosts a run can have. */
const maxHosts = hostFirstWords.length * hostSecondWords.length;

type CategoryShape = {
  activities: string[];
  priceRange: [low: number, high: number];
  durations: number[];
  outdoor: boolean;
};

const shapes: Record<string, CategoryShape> = {
  'ceramics-and-crafts': {
    activities: [
      'Wheel throwing',
      'Hand-building mugs',
      'Glaze and fire a plate',
      'Block printing',
      'Candle pouring',
      'Hand-bound notebooks',
      'Weaving a wall hanging',
      'Natural dye workshop',
    ],
    priceRange: [4500, 13000],
    durations: [90, 120, 150, 180],
    outdoor: false,
  },
  cooking: {
    activities: [
      'Hand-rolled pasta',
      'Dumpling folding',
      'Sourdough basics',
      'Knife skills',
      'Tamale making',
      'Pickling workshop',
      'Bao from scratch',
      'Fresh cheese making',
    ],
    priceRange: [5500, 11000],
    durations: [120, 150, 180],
    outdoor: false,
  },
  'walking-tours': {
    activities: [
      'Architecture walk',
      'Street food walk',
      'Bookshop crawl',
      'Murals and side streets',
      'Waterfront history walk',
      'Neighborhood food history',
      'Park and garden walk',
      'Jazz history walk',
    ],
    priceRange: [2500, 6500],
    durations: [60, 90, 120],
    outdoor: true,
  },
  'wine-and-cocktails': {
    activities: [
      'Natural wine tasting',
      'Cocktail basics',
      'Sake tasting',
      'Vermouth and aperitivo',
      'Beer and cheese pairing',
      'Mezcal tasting',
      'Home bar essentials',
      'Champagne and oysters',
    ],
    priceRange: [4000, 9500],
    durations: [75, 90, 120],
    outdoor: false,
  },
  'food-and-coffee': {
    activities: [
      'Coffee cupping',
      'Chocolate tasting',
      'Cheese tasting',
      'Hot sauce tasting',
      'Tea ceremony',
      'Dumpling crawl',
      'Bagel and lox tasting',
      'Olive oil tasting',
    ],
    priceRange: [2500, 7500],
    durations: [60, 75, 90],
    outdoor: false,
  },
  outdoors: {
    activities: [
      'Sunset kayak',
      'Harbor paddle',
      'Bike the greenway',
      'Sailing lesson',
      'Paddleboard basics',
      'Birdwatching walk',
      'Climbing intro',
      'Fishing at dawn',
    ],
    priceRange: [5000, 16000],
    durations: [90, 120, 180],
    outdoor: true,
  },
  wellness: {
    activities: [
      'Sound bath',
      'Gentle yoga',
      'Breathwork hour',
      'Meditation for beginners',
      'Restorative stretch',
      'Tai chi in the park',
      'Pilates mat class',
      'Forest bathing',
    ],
    priceRange: [2000, 6000],
    durations: [45, 60, 75],
    outdoor: false,
  },
  kids: {
    activities: [
      "Kids' pottery",
      'Little bakers',
      'Junior science lab',
      'Story walk',
      'Puppet making',
      "Kids' cooking club",
      'Drawing studio',
      'Nature scavenger hunt',
    ],
    priceRange: [2500, 5500],
    durations: [60, 75, 90],
    outdoor: false,
  },
};

const introSentences = [
  'A small-group session for people who like learning by doing.',
  'Come as you are; the host walks you through every step.',
  'A relaxed session with room to ask questions.',
  'Everything you need is provided, and you take something home.',
  'Beginners are the usual crowd, and nobody is rushed.',
  'A neighborhood favorite that fills up on weekends.',
];

const closerSentences = [
  'Groups stay small so everyone gets time with the host.',
  'The host sends a note the day before with what to wear.',
  'Ask about dietary needs before you book and the host will plan for them.',
  'You will leave knowing how to do it again at home.',
  'Bring a friend, or come alone and meet a few people.',
  'Seating is comfortable and breaks are built in.',
];

const includedLines = [
  'All materials and equipment.',
  'Tools, aprons, and a take-home piece.',
  'A tasting plate and a drink.',
  'Gear and a short lesson.',
  'Snacks, water, and a printed guide.',
];

const accessibilityLines = [
  'Step-free entrance.',
  'Seating for everyone, and breaks whenever you need them.',
  'The space is up one flight of stairs.',
  'Accessible restroom on the same floor.',
];

const startTimes = [
  '09:00',
  '10:30',
  '12:00',
  '14:00',
  '16:00',
  '18:00',
  '19:30',
];
const allocations = [4, 6, 8, 10, 12, 16, 20, 30];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A shuffled copy (Fisher-Yates), so the first few of it are a random sample without repeats. */
function shuffled<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = random.int(0, i);
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

function checkOptions({ experiences, seed }: ScaleOptions) {
  if (
    !Number.isInteger(experiences) ||
    experiences < 1 ||
    experiences > maxScaleExperiences
  ) {
    throw new RangeError(
      `The scale fixture makes 1 to ${String(maxScaleExperiences)} experiences`,
    );
  }
  createRandom(seed);
}

type ScaleHost = HostFixture & {
  categorySlug: string;
  neighborhoodName: string;
  neighborhoodSlug: string;
};

function makeHosts(count: number, random: Random): ScaleHost[] {
  const names = shuffled(
    hostFirstWords.flatMap((first) =>
      hostSecondWords.map((second) => `${first} ${second}`),
    ),
    random,
  ).slice(0, count);
  return names.map((name) => {
    const category = random.pick(categories);
    const neighborhood = random.pick(neighborhoods);
    return {
      slug: slugify(name),
      name,
      description: `${name} runs small-group sessions in ${neighborhood.name}.`,
      categorySlug: category.slug,
      neighborhoodSlug: neighborhood.slug,
      neighborhoodName: neighborhood.name,
    };
  });
}

function nearestFive(cents: number): number {
  return Math.round(cents / 500) * 500;
}

function makePrices(
  categorySlug: string,
  shape: CategoryShape,
  random: Random,
): PriceFixture[] {
  const [low, high] = shape.priceRange;
  const adult = nearestFive(random.int(low, high));
  if (categorySlug === 'kids') {
    return [
      { kind: 'adult', priceMinor: 0, usesSpace: false },
      { kind: 'child', priceMinor: adult, usesSpace: true },
    ];
  }
  const prices: PriceFixture[] = [
    { kind: 'adult', priceMinor: adult, usesSpace: true },
  ];
  if (random.chance(0.12)) {
    prices.push({
      kind: 'child',
      priceMinor: Math.max(500, nearestFive(adult * 0.6)),
      usesSpace: true,
    });
  }
  return prices;
}

// Kids' classes run on weekends, as the curated ones do. That keeps the zero-results state (S2: kids
// in Williamsburg on a weeknight) true when the scale fixture is loaded beside the curated set.
const weekendDays = [0, 6] as const;

function makeSlots(
  durationMinutes: number,
  weekendOnly: boolean,
  random: Random,
): SlotFixture[] {
  const count = random.weighted([
    [1, 45],
    [2, 40],
    [3, 15],
  ] as const);
  const slots: SlotFixture[] = [];
  const taken = new Set<string>();
  // A bounded number of tries: two random slots can collide, and a collision is simply skipped.
  for (
    let attempt = 0;
    attempt < count * 3 && slots.length < count;
    attempt += 1
  ) {
    const weekday = weekendOnly ? random.pick(weekendDays) : random.int(0, 6);
    const startTime = random.pick(startTimes);
    const key = `${String(weekday)}@${startTime}`;
    if (taken.has(key)) continue;
    taken.add(key);
    slots.push({
      weekday,
      startTime,
      durationMinutes,
      allocation: random.pick(allocations),
    });
  }
  return slots;
}

function makeExperience(
  index: number,
  host: ScaleHost,
  random: Random,
): ExperienceFixture {
  const categorySlug = random.chance(0.75)
    ? host.categorySlug
    : random.pick(categories).slug;
  const shape = shapes[categorySlug];
  if (!shape) throw new Error(`No scale shape for category ${categorySlug}`);
  const activity = random.pick(shape.activities);
  const name = `${activity} at ${host.name}`;
  const status = random.weighted([
    ['live', 90],
    ['guide_only', 4],
    ['paused', 3],
    ['draft', 2],
    ['in_review', 1],
  ] as const);
  const bookable = status === 'live' || status === 'paused';
  const durationMinutes = random.pick(shape.durations);

  const outdoor = shape.outdoor;
  const weatherPolicy = outdoor
    ? random.weighted([
        ['rain_or_shine', 60],
        ['decided_before_start', 40],
      ] as const)
    : null;
  const ageRule =
    categorySlug === 'kids'
      ? 'age_range'
      : categorySlug === 'wine-and-cocktails'
        ? 'twenty_one_plus'
        : random.weighted([
            ['all_ages', 85],
            ['minimum_age', 15],
          ] as const);
  const childMin = random.int(3, 8);

  return {
    slug: `${slugify(name)}-${String(index + 1)}`,
    hostSlug: host.slug,
    categorySlug,
    neighborhoodSlug: host.neighborhoodSlug,
    tier: random.weighted([
      ['flexible', 60],
      ['moderate', 25],
      ['strict', 15],
    ] as const),
    name,
    description: `${random.pick(introSentences)} Led by ${host.name} in ${host.neighborhoodName}. ${random.pick(closerSentences)}`,
    meetingPoint: `${host.name}, ${host.neighborhoodName}.`,
    included: random.pick(includedLines),
    durationMinutes,
    accessibilityNotes: random.chance(0.5)
      ? random.pick(accessibilityLines)
      : null,
    status,
    outdoor,
    weatherPolicy,
    weatherDecisionHours:
      weatherPolicy === 'decided_before_start'
        ? random.pick([2, 3, 4, 6])
        : null,
    ageRule,
    minAge:
      ageRule === 'age_range'
        ? childMin
        : ageRule === 'minimum_age'
          ? random.pick([12, 14, 16, 18])
          : null,
    maxAge: ageRule === 'age_range' ? childMin + random.int(3, 6) : null,
    taxTreatment: random.weighted([
      ['unknown', 20],
      ['taxable', 40],
      ['not_taxable', 40],
    ] as const),
    waiverDoc: null,
    linkOutUrl:
      status === 'guide_only'
        ? `https://${host.slug}.example.com/classes`
        : null,
    affiliateUrl: null,
    prices:
      status === 'guide_only' ? [] : makePrices(categorySlug, shape, random),
    slots: bookable
      ? makeSlots(durationMinutes, categorySlug === 'kids', random)
      : [],
  };
}

/** Hosts and experiences for the options. The same options always give the same fixtures. */
export function generateScaleFixtures(options: ScaleOptions): ScaleFixtures {
  checkOptions(options);
  const random = createRandom(options.seed);
  const hostCount = Math.min(
    maxHosts,
    Math.max(1, Math.round(options.experiences * hostsPerExperience)),
  );
  const scaleHosts = makeHosts(hostCount, random);
  const experiences: ExperienceFixture[] = [];
  for (let index = 0; index < options.experiences; index += 1) {
    const host = scaleHosts[index % scaleHosts.length];
    if (!host) throw new Error('The scale fixture has no hosts');
    experiences.push(makeExperience(index, host, random));
  }
  return {
    hosts: scaleHosts.map(({ slug, name, description }) => ({
      slug,
      name,
      description,
    })),
    experiences,
  };
}
