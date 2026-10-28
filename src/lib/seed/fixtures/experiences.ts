import type { ExperienceFixture, HostFixture } from '../types';

// The coverage set: the fewest experiences that put data behind every P3 state (see coverage.ts).
// It is not the curated catalog. U-021b grows the catalog around it. Everything here is fictional
// and written fresh for Ramble; no name, address, or sentence comes from any real business.

export const hosts: HostFixture[] = [
  {
    slug: 'hudson-paddle-club',
    name: 'Hudson Paddle Club',
    description:
      'Six guides, all trained in water rescue. On Ramble since 2026.',
  },
  {
    slug: 'wheelhouse-kids-studio',
    name: 'Wheelhouse Kids Studio',
    description:
      'A Williamsburg studio where small hands get their own wheels and a teacher who never rushes.',
  },
  {
    slug: 'little-bakers-co',
    name: 'Little Bakers Co.',
    description:
      'Two former pastry cooks who teach kids to bake in a Park Slope storefront.',
  },
  {
    slug: 'orchard-street-wine-room',
    name: 'Orchard Street Wine Room',
    description:
      'A twelve-seat wine bar on the Lower East Side that pours small-batch bottles and answers every question.',
  },
  {
    slug: 'salt-and-semolina',
    name: 'Salt & Semolina',
    description:
      'A teaching kitchen on the ground floor of a Carroll Gardens brownstone. Aprons provided.',
  },
  {
    slug: 'steam-and-fold',
    name: 'Steam & Fold',
    description:
      'Three generations of one Sunset Park family, teaching the folds they learned at their own table.',
  },
  {
    slug: 'kiln-and-clay',
    name: 'Kiln & Clay',
    description:
      'A shared Williamsburg pottery studio with twelve wheels and a long waiting list for the kiln.',
  },
  {
    slug: 'cast-iron-walks',
    name: 'Cast Iron Walks',
    description:
      'Two architecture nerds who lead small walking groups below Canal Street.',
  },
  {
    slug: 'low-tide-studio',
    name: 'Low Tide Studio',
    description:
      'A quiet Sunset Park studio for sound baths and slow yoga, run by the people who built it.',
  },
  {
    slug: 'bean-counter-coffee-lab',
    name: 'Bean Counter Coffee Lab',
    description:
      'A Williamsburg roaster that lets you taste the same coffee six different ways.',
  },
  {
    slug: 'rise-bakery',
    name: 'Rise Bakery',
    description:
      'A Park Slope neighborhood bakery. Ramble lists its classes; Rise takes the bookings.',
  },
];

type Required = Pick<
  ExperienceFixture,
  | 'slug'
  | 'hostSlug'
  | 'categorySlug'
  | 'neighborhoodSlug'
  | 'name'
  | 'description'
>;

function experience(
  required: Required,
  rest: Partial<ExperienceFixture>,
): ExperienceFixture {
  return {
    tier: 'flexible',
    meetingPoint: null,
    included: null,
    durationMinutes: null,
    accessibilityNotes: null,
    status: 'live',
    outdoor: false,
    weatherPolicy: null,
    weatherDecisionHours: null,
    ageRule: 'all_ages',
    minAge: null,
    maxAge: null,
    taxTreatment: 'not_taxable',
    waiverDoc: null,
    linkOutUrl: null,
    affiliateUrl: null,
    prices: [],
    slots: [],
    ...required,
    ...rest,
  };
}

export const experiences: ExperienceFixture[] = [
  // 03, 04, 05, 06, S4, S5, S7, S10: outdoor, a weather call, a waiver, an age rule, and one
  // Saturday (the second from the start of the range) with an open, a one-space, and a sold-out time.
  experience(
    {
      slug: 'sunset-kayak-on-the-hudson',
      hostSlug: 'hudson-paddle-club',
      categorySlug: 'outdoors',
      neighborhoodSlug: 'tribeca',
      name: 'Sunset kayak on the Hudson',
      description:
        'Paddle out as the light goes gold. Guides start with a 20-minute lesson on the dock, then lead a slow loop past the piers while the skyline turns pink behind you. No experience needed, and everyone wears a life jacket.',
    },
    {
      meetingPoint:
        'Pier 26 boathouse, Tribeca. The exact door is in your confirmation.',
      included:
        'A kayak, paddle, and life jacket, a 20-minute lesson on the dock, and a dry bag for your phone.',
      durationMinutes: 120,
      accessibilityNotes:
        "There's a ramp down to the dock. Getting into a kayak takes some mobility, and guides can help. Ask the host before you book.",
      outdoor: true,
      weatherPolicy: 'decided_before_start',
      weatherDecisionHours: 3,
      ageRule: 'minimum_age',
      minAge: 12,
      taxTreatment: 'not_taxable',
      waiverDoc: 'waiver-hudson-paddle-club',
      prices: [{ kind: 'adult', priceMinor: 6500, usesSpace: true }],
      slots: [
        {
          weekday: 6,
          startTime: '14:00',
          durationMinutes: 120,
          allocation: 12,
        },
        {
          weekday: 6,
          startTime: '17:30',
          durationMinutes: 120,
          allocation: 12,
          leaves: [{ occurrence: 1, spacesLeft: 1 }],
        },
        {
          weekday: 6,
          startTime: '19:30',
          durationMinutes: 120,
          allocation: 12,
          leaves: [{ occurrence: 1, spacesLeft: 0 }],
        },
        {
          weekday: 0,
          startTime: '17:30',
          durationMinutes: 120,
          allocation: 12,
          leaves: [{ occurrence: 2, spacesLeft: 2 }],
        },
        {
          weekday: 3,
          startTime: '18:00',
          durationMinutes: 120,
          allocation: 12,
        },
      ],
    },
  ),
  // 04b, S2: children and the adult counted apart, and nothing on a weeknight.
  experience(
    {
      slug: 'kids-wheel-class',
      hostSlug: 'wheelhouse-kids-studio',
      categorySlug: 'kids',
      neighborhoodSlug: 'williamsburg',
      name: "Kids' wheel class",
      description:
        'Kids sit at their own wheel and make a bowl they can use at breakfast. The teacher keeps the group to eight, so every child gets hands-on help. One adult stays and cheers; they do not need a ticket.',
    },
    {
      meetingPoint: 'Wheelhouse Kids Studio, ground floor, Williamsburg.',
      included:
        'Clay, aprons, and firing. Bowls are ready for pickup in two weeks.',
      durationMinutes: 90,
      accessibilityNotes: 'Step-free entrance and a low sink for small hands.',
      ageRule: 'age_range',
      minAge: 5,
      maxAge: 10,
      taxTreatment: 'not_taxable',
      prices: [
        { kind: 'adult', priceMinor: 0, usesSpace: false },
        { kind: 'child', priceMinor: 4500, usesSpace: true },
      ],
      slots: [
        { weekday: 6, startTime: '10:00', durationMinutes: 90, allocation: 8 },
        { weekday: 6, startTime: '12:30', durationMinutes: 90, allocation: 8 },
        { weekday: 0, startTime: '10:00', durationMinutes: 90, allocation: 8 },
      ],
    },
  ),
  // S2: a kids' class one neighborhood over, open this weekend.
  experience(
    {
      slug: 'little-bakers-cookie-club',
      hostSlug: 'little-bakers-co',
      categorySlug: 'kids',
      neighborhoodSlug: 'park-slope',
      name: 'Little bakers: cookie club',
      description:
        'Kids roll, cut, and decorate a dozen cookies, then take the box home. The kitchen is small on purpose, so no one waits long for the sprinkles.',
    },
    {
      meetingPoint: 'Little Bakers Co. storefront, Park Slope.',
      included: 'All ingredients, a cookie box, and an apron to keep.',
      durationMinutes: 75,
      accessibilityNotes: 'Step-free entrance. Nut-free kitchen.',
      ageRule: 'age_range',
      minAge: 4,
      maxAge: 9,
      prices: [
        { kind: 'adult', priceMinor: 0, usesSpace: false },
        { kind: 'child', priceMinor: 3800, usesSpace: true },
      ],
      slots: [
        { weekday: 6, startTime: '11:00', durationMinutes: 75, allocation: 10 },
        { weekday: 0, startTime: '11:00', durationMinutes: 75, allocation: 10 },
      ],
    },
  ),
  // 04c, 05: 21 and over, taxable, a moderate cancellation window.
  experience(
    {
      slug: 'natural-wine-explained',
      hostSlug: 'orchard-street-wine-room',
      categorySlug: 'wine-and-cocktails',
      neighborhoodSlug: 'lower-east-side',
      name: 'Natural wine, explained',
      description:
        'Six small-batch bottles, one patient host, and no jargon you have to nod along to. You will leave knowing what you like and how to ask for it.',
    },
    {
      tier: 'moderate',
      meetingPoint: 'Orchard Street Wine Room, Lower East Side.',
      included: 'Six pours, bread and cheese, and tasting notes to take home.',
      durationMinutes: 90,
      accessibilityNotes: 'Step-free entrance from the sidewalk.',
      ageRule: 'twenty_one_plus',
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 4800, usesSpace: true }],
      slots: [
        { weekday: 4, startTime: '19:00', durationMinutes: 90, allocation: 14 },
        { weekday: 5, startTime: '19:00', durationMinutes: 90, allocation: 14 },
        { weekday: 6, startTime: '18:00', durationMinutes: 90, allocation: 14 },
        { weekday: 0, startTime: '19:00', durationMinutes: 90, allocation: 14 },
      ],
    },
  ),
  experience(
    {
      slug: 'hand-rolled-pasta-in-carroll-gardens',
      hostSlug: 'salt-and-semolina',
      categorySlug: 'cooking',
      neighborhoodSlug: 'carroll-gardens',
      name: 'Hand-rolled pasta in Carroll Gardens',
      description:
        'Mix the dough, roll it thin, and cut two shapes by hand, then sit down to eat them with a sauce the teacher made that morning. Small groups, a real kitchen, and dinner more often than not.',
    },
    {
      meetingPoint:
        'Salt & Semolina, Carroll Gardens. Ring the bell marked Kitchen.',
      included:
        'Ingredients, aprons, and the meal you make, with a glass of wine or soda.',
      durationMinutes: 150,
      ageRule: 'minimum_age',
      minAge: 14,
      taxTreatment: 'unknown',
      prices: [{ kind: 'adult', priceMinor: 8500, usesSpace: true }],
      slots: [
        {
          weekday: 2,
          startTime: '18:30',
          durationMinutes: 150,
          allocation: 10,
        },
        {
          weekday: 4,
          startTime: '18:30',
          durationMinutes: 150,
          allocation: 10,
        },
        {
          weekday: 6,
          startTime: '12:00',
          durationMinutes: 150,
          allocation: 10,
        },
      ],
    },
  ),
  experience(
    {
      slug: 'dumpling-folding-in-sunset-park',
      hostSlug: 'steam-and-fold',
      categorySlug: 'cooking',
      neighborhoodSlug: 'sunset-park',
      name: 'Dumpling folding in Sunset Park',
      description:
        'Learn three folds from a family that has been making dumplings for three generations. You fill, pleat, and steam your own, and everything you fold you eat.',
    },
    {
      meetingPoint: 'Steam & Fold, Eighth Avenue, Sunset Park.',
      included:
        'Dough, fillings, tea, and a take-home box of frozen dumplings.',
      durationMinutes: 120,
      accessibilityNotes: 'Step-free entrance. Seated work at a long table.',
      prices: [{ kind: 'adult', priceMinor: 6000, usesSpace: true }],
      slots: [
        { weekday: 3, startTime: '18:30', durationMinutes: 120, allocation: 8 },
        { weekday: 0, startTime: '13:00', durationMinutes: 120, allocation: 8 },
      ],
    },
  ),
  // The strictest cancellation tier, and a studio with stairs.
  experience(
    {
      slug: 'wheel-throwing-for-beginners',
      hostSlug: 'kiln-and-clay',
      categorySlug: 'ceramics-and-crafts',
      neighborhoodSlug: 'williamsburg',
      name: 'Wheel throwing for beginners',
      description:
        'Center the clay, pull up the walls, and make a mug you will actually use. The studio keeps the class to eight, and the teacher fires your piece for pickup two weeks later.',
    },
    {
      tier: 'strict',
      meetingPoint: 'Kiln & Clay, second floor, Williamsburg.',
      included: 'Clay, tools, aprons, glazing, and firing.',
      durationMinutes: 120,
      accessibilityNotes:
        "The studio is up one flight of stairs and there's no elevator.",
      ageRule: 'minimum_age',
      minAge: 16,
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 9500, usesSpace: true }],
      slots: [
        { weekday: 3, startTime: '19:00', durationMinutes: 120, allocation: 8 },
        { weekday: 5, startTime: '19:00', durationMinutes: 120, allocation: 8 },
        { weekday: 6, startTime: '15:00', durationMinutes: 120, allocation: 8 },
      ],
    },
  ),
  // 06: a second experience in the kayak's neighborhood, for "more near Pier 26". Rain or shine.
  experience(
    {
      slug: 'cast-iron-and-cobblestones',
      hostSlug: 'cast-iron-walks',
      categorySlug: 'walking-tours',
      neighborhoodSlug: 'tribeca',
      name: 'Cast iron and cobblestones: a Tribeca walk',
      description:
        'A slow loop through the old warehouse blocks, with stops at the details most people walk past: loading docks, iron columns, and the doors that used to open onto ships.',
    },
    {
      meetingPoint: 'The corner of Greenwich and Harrison Streets, Tribeca.',
      included: 'A guide, a printed map, and a coffee stop.',
      durationMinutes: 90,
      accessibilityNotes:
        'Flat streets the whole way, about a mile at a gentle pace.',
      outdoor: true,
      weatherPolicy: 'rain_or_shine',
      prices: [{ kind: 'adult', priceMinor: 3500, usesSpace: true }],
      slots: [
        { weekday: 6, startTime: '10:30', durationMinutes: 90, allocation: 15 },
        { weekday: 0, startTime: '10:30', durationMinutes: 90, allocation: 15 },
        { weekday: 2, startTime: '17:00', durationMinutes: 90, allocation: 15 },
      ],
    },
  ),
  // A host whose capacity Ramble sells from an allocation set up by ops (PRD-42).
  experience(
    {
      slug: 'sunday-sound-bath',
      hostSlug: 'low-tide-studio',
      categorySlug: 'wellness',
      neighborhoodSlug: 'sunset-park',
      name: 'Sunday sound bath',
      description:
        'Lie back while gongs, bowls, and chimes fill the room. There is nothing to do and nowhere to be, and most people say it is the best hour of their week.',
    },
    {
      tier: 'moderate',
      meetingPoint: 'Low Tide Studio, Sunset Park.',
      included: 'Mats, blankets, and bolsters. Bring a layer if you run cold.',
      durationMinutes: 60,
      accessibilityNotes:
        'Step-free entrance. You can lie down or sit in a chair.',
      ageRule: 'minimum_age',
      minAge: 16,
      prices: [{ kind: 'adult', priceMinor: 4200, usesSpace: true }],
      slots: [
        {
          weekday: 0,
          startTime: '18:00',
          durationMinutes: 60,
          allocation: 20,
          source: 'allocation',
        },
        {
          weekday: 1,
          startTime: '19:30',
          durationMinutes: 60,
          allocation: 20,
          source: 'allocation',
        },
      ],
    },
  ),
  experience(
    {
      slug: 'coffee-cupping-in-williamsburg',
      hostSlug: 'bean-counter-coffee-lab',
      categorySlug: 'food-and-coffee',
      neighborhoodSlug: 'williamsburg',
      name: 'Coffee cupping in Williamsburg',
      description:
        'Taste one coffee six ways and find out why the same bean can be sweet, sharp, or smoky. Come hungry for the pastries, and leave with a bag of whichever you liked best.',
    },
    {
      meetingPoint: 'Bean Counter Coffee Lab, Williamsburg.',
      included: 'Six tastings, pastries, and a 250 gram bag of beans.',
      durationMinutes: 75,
      accessibilityNotes: 'Step-free entrance and bar seating with backs.',
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 3000, usesSpace: true }],
      slots: [
        { weekday: 6, startTime: '11:00', durationMinutes: 75, allocation: 10 },
        { weekday: 2, startTime: '08:30', durationMinutes: 75, allocation: 10 },
      ],
    },
  ),
  // 03b: a guide entry that links out. No sessions and no prices; Ramble sells nothing here.
  experience(
    {
      slug: 'sourdough-mornings-at-rise-bakery',
      hostSlug: 'rise-bakery',
      categorySlug: 'cooking',
      neighborhoodSlug: 'park-slope',
      name: 'Sourdough mornings at Rise Bakery',
      description:
        'Rise opens its kitchen on Saturday mornings for a two-hour sourdough class: feed a starter, shape a loaf, and take it home to bake. One of our favorite slow mornings in Park Slope.',
    },
    {
      status: 'guide_only',
      meetingPoint: 'Rise Bakery, Park Slope.',
      durationMinutes: 120,
      linkOutUrl: 'https://rise-bakery.example.com/classes',
    },
  ),
  // Hidden from guests in every status that is not live or guide-only (ADR 0008, PRD-12).
  experience(
    {
      slug: 'fresh-mozzarella-night',
      hostSlug: 'salt-and-semolina',
      categorySlug: 'cooking',
      neighborhoodSlug: 'carroll-gardens',
      name: 'Fresh mozzarella night',
      description:
        'Stretch your own mozzarella from curd and eat it warm. Still being written up with the host.',
    },
    {
      status: 'draft',
      durationMinutes: 90,
      prices: [{ kind: 'adult', priceMinor: 7000, usesSpace: true }],
    },
  ),
  experience(
    {
      slug: 'rooftop-sunrise-yoga',
      hostSlug: 'low-tide-studio',
      categorySlug: 'wellness',
      neighborhoodSlug: 'sunset-park',
      name: 'Rooftop sunrise yoga',
      description:
        'A gentle flow on a Sunset Park roof as the sun comes up. Waiting on the host to confirm the roof access.',
    },
    {
      status: 'in_review',
      outdoor: true,
      weatherPolicy: 'rain_or_shine',
      durationMinutes: 60,
      prices: [{ kind: 'adult', priceMinor: 3000, usesSpace: true }],
    },
  ),
  experience(
    {
      slug: 'winter-paddle-series',
      hostSlug: 'hudson-paddle-club',
      categorySlug: 'outdoors',
      neighborhoodSlug: 'tribeca',
      name: 'Winter paddle series',
      description:
        'Cold-weather paddles in dry suits. Paused for the season; the host will bring it back in spring.',
    },
    {
      status: 'paused',
      outdoor: true,
      weatherPolicy: 'decided_before_start',
      weatherDecisionHours: 4,
      ageRule: 'minimum_age',
      minAge: 14,
      durationMinutes: 120,
      prices: [{ kind: 'adult', priceMinor: 8000, usesSpace: true }],
      slots: [
        { weekday: 6, startTime: '11:00', durationMinutes: 120, allocation: 8 },
      ],
    },
  ),
];
