import type { ExperienceFixture } from '../types';
import { experience } from './experiences';
import { slot } from './slots';

// Walks, outdoor days, wellness, and kids' classes for the curated catalog. Kids' classes avoid
// Williamsburg, where the coverage set keeps kids weekend-only so the zero-results state (S2) stays true.

const hudsonWaiver = 'waiver-hudson-paddle-club';
const bikeWaiver = 'waiver-spoke-and-saddle';

export const outdoorExperiences: ExperienceFixture[] = [
  experience(
    {
      slug: 'lower-east-side-stoop-stories',
      hostSlug: 'cast-iron-walks',
      categorySlug: 'walking-tours',
      neighborhoodSlug: 'lower-east-side',
      name: 'Stoop stories on the Lower East Side',
      description:
        'A slow walk past tenement stoops, bakeries, and old synagogue doors, with the stories that go with them. Your guide points out what changed and what stubbornly did not.',
    },
    {
      meetingPoint:
        'The corner of Orchard and Delancey Streets, Lower East Side.',
      included: 'A guide and a pastry stop.',
      durationMinutes: 90,
      accessibilityNotes:
        'Flat streets, about a mile at a gentle pace, with benches along the route.',
      outdoor: true,
      weatherPolicy: 'rain_or_shine',
      prices: [{ kind: 'adult', priceMinor: 3200, usesSpace: true }],
      slots: [
        slot(6, '14:00', 90, 14),
        slot(0, '11:00', 90, 14),
        slot(3, '17:30', 90, 14),
      ],
    },
  ),
  experience(
    {
      slug: 'sunset-park-side-streets-walk',
      hostSlug: 'corner-table-tours',
      categorySlug: 'walking-tours',
      neighborhoodSlug: 'sunset-park',
      name: 'Sunset Park side streets',
      description:
        'Skip the main avenues for the blocks behind them: murals, a hillside park with a skyline view, and the shops that open early. The route climbs gently and ends with tea.',
    },
    {
      meetingPoint:
        'The subway entrance at 36th Street and Fourth Avenue, Sunset Park.',
      included: 'A guide and a pot of tea at the end.',
      durationMinutes: 120,
      accessibilityNotes:
        'One steady uphill stretch, with benches at the park. Ask the guide about a shorter route.',
      outdoor: true,
      weatherPolicy: 'decided_before_start',
      weatherDecisionHours: 4,
      prices: [{ kind: 'adult', priceMinor: 3800, usesSpace: true }],
      slots: [slot(6, '10:00', 120, 12), slot(0, '15:00', 120, 12)],
    },
  ),
  experience(
    {
      slug: 'park-slope-brownstone-walk',
      hostSlug: 'cast-iron-walks',
      categorySlug: 'walking-tours',
      neighborhoodSlug: 'park-slope',
      name: 'Park Slope brownstone walk',
      description:
        'Learn to read a row of brownstones: the stoops, the cornices, and the small clues about who built them and when. You finish at the edge of the park with a view down the hill.',
    },
    {
      meetingPoint: 'The arch at Grand Army Plaza, Park Slope side.',
      included: 'A guide and a printed street map.',
      durationMinutes: 75,
      accessibilityNotes:
        'Gentle hills, with two steeper blocks. The route can be shortened.',
      outdoor: true,
      weatherPolicy: 'rain_or_shine',
      prices: [{ kind: 'adult', priceMinor: 2800, usesSpace: true }],
      slots: [slot(6, '11:00', 75, 15), slot(4, '17:00', 75, 15)],
    },
  ),
  experience(
    {
      slug: 'waterfront-bike-ride-from-sunset-park',
      hostSlug: 'spoke-and-saddle',
      categorySlug: 'outdoors',
      neighborhoodSlug: 'sunset-park',
      name: 'Waterfront bike ride from Sunset Park',
      description:
        'An easy ride along the Brooklyn waterfront on protected bike paths, with stops for the view and a cold drink. The slowest rider sets the pace, and the guide carries a spare tube.',
    },
    {
      meetingPoint:
        'Spoke & Saddle, near the Sunset Park waterfront. The exact spot is in your confirmation.',
      included: 'A city bike, helmet, lock, water, and a guide.',
      durationMinutes: 150,
      accessibilityNotes:
        'Step-through and adaptive bikes are available. Tell the host when you book.',
      outdoor: true,
      weatherPolicy: 'decided_before_start',
      weatherDecisionHours: 3,
      ageRule: 'minimum_age',
      minAge: 12,
      waiverDoc: bikeWaiver,
      prices: [{ kind: 'adult', priceMinor: 5500, usesSpace: true }],
      slots: [slot(6, '10:00', 150, 10), slot(0, '10:00', 150, 10)],
    },
  ),
  // Paused for the season: hidden from guests, with its sessions kept.
  experience(
    {
      slug: 'twilight-pedal-along-the-waterfront',
      hostSlug: 'spoke-and-saddle',
      categorySlug: 'outdoors',
      neighborhoodSlug: 'tribeca',
      name: 'Twilight pedal along the waterfront',
      description:
        'A summer-evening ride from Tribeca up the river path. Paused for the season; the host will bring it back in spring.',
    },
    {
      status: 'paused',
      outdoor: true,
      weatherPolicy: 'decided_before_start',
      weatherDecisionHours: 2,
      ageRule: 'minimum_age',
      minAge: 14,
      durationMinutes: 120,
      waiverDoc: bikeWaiver,
      prices: [{ kind: 'adult', priceMinor: 6000, usesSpace: true }],
      slots: [slot(4, '18:30', 120, 10)],
    },
  ),
  // Strict tier, the highest price, and a first Saturday with no spaces left.
  experience(
    {
      slug: 'learn-to-kayak-in-the-cove',
      hostSlug: 'hudson-paddle-club',
      categorySlug: 'outdoors',
      neighborhoodSlug: 'tribeca',
      name: 'Learn to kayak in the cove',
      description:
        'A three-hour first lesson in flat, sheltered water: how to sit, how to steer, and what to do if you tip. You finish with a lap on your own and a guide alongside.',
    },
    {
      tier: 'strict',
      meetingPoint:
        'Pier 26 boathouse, Tribeca. The exact door is in your confirmation.',
      included:
        "A kayak, paddle, life jacket, a wetsuit top if it's cool, and a dry bag.",
      durationMinutes: 180,
      accessibilityNotes:
        "There's a ramp down to the dock. Getting into a kayak takes some mobility, and guides can help.",
      outdoor: true,
      weatherPolicy: 'decided_before_start',
      weatherDecisionHours: 4,
      ageRule: 'minimum_age',
      minAge: 16,
      waiverDoc: hudsonWaiver,
      prices: [{ kind: 'adult', priceMinor: 12000, usesSpace: true }],
      slots: [
        slot(6, '09:00', 180, 8, [{ occurrence: 0, spacesLeft: 0 }]),
        slot(0, '09:00', 180, 8),
      ],
    },
  ),
  experience(
    {
      slug: 'saturday-morning-at-the-stoop-garden',
      hostSlug: 'stoop-garden-club',
      categorySlug: 'outdoors',
      neighborhoodSlug: 'park-slope',
      name: 'Saturday morning at the stoop garden',
      description:
        "You'll weed, water, and harvest alongside the volunteers who keep this Park Slope garden going. You learn what's in season and take home a bag of what you picked, and the rest goes to a neighbor's table.",
    },
    {
      meetingPoint: 'The Stoop Garden gate on Seventh Avenue, Park Slope.',
      included:
        'Gloves, tools, lemonade, and a bag of vegetables to take home.',
      durationMinutes: 120,
      accessibilityNotes:
        'Raised beds you can reach from a chair, and a step-free path from the gate.',
      outdoor: true,
      weatherPolicy: 'rain_or_shine',
      prices: [
        { kind: 'adult', priceMinor: 1800, usesSpace: true },
        { kind: 'child', priceMinor: 900, usesSpace: true },
      ],
      slots: [slot(6, '10:00', 120, 25)],
    },
  ),
  experience(
    {
      slug: 'candlelit-restorative-yoga',
      hostSlug: 'low-tide-studio',
      categorySlug: 'wellness',
      neighborhoodSlug: 'sunset-park',
      name: 'Candlelit restorative yoga',
      description:
        'Held poses, soft light, and a teacher who talks you down at the end of the day. The props do most of the work, and no one asks you to touch your toes.',
    },
    {
      meetingPoint: 'Low Tide Studio, Sunset Park.',
      included: 'Mats, bolsters, blankets, and eye pillows.',
      durationMinutes: 75,
      accessibilityNotes:
        'Step-free entrance. A chair is available for any pose.',
      ageRule: 'minimum_age',
      minAge: 14,
      prices: [{ kind: 'adult', priceMinor: 2800, usesSpace: true }],
      slots: [slot(2, '19:00', 75, 14), slot(5, '18:30', 75, 14)],
    },
  ),
  experience(
    {
      slug: 'garden-meditation-morning',
      hostSlug: 'stoop-garden-club',
      categorySlug: 'wellness',
      neighborhoodSlug: 'park-slope',
      name: 'Garden meditation morning',
      description:
        'A teacher who keeps it short and kind leads twenty minutes of quiet among the raised beds, then a slow walk through the garden and tea before you go.',
    },
    {
      meetingPoint: 'The Stoop Garden gate on Seventh Avenue, Park Slope.',
      included: 'Cushions, blankets, and tea.',
      durationMinutes: 60,
      accessibilityNotes:
        'A step-free path from the gate, and chairs for anyone who prefers one.',
      outdoor: true,
      weatherPolicy: 'decided_before_start',
      weatherDecisionHours: 2,
      prices: [{ kind: 'adult', priceMinor: 2200, usesSpace: true }],
      slots: [slot(0, '09:00', 60, 15), slot(3, '08:00', 60, 15)],
    },
  ),
  experience(
    {
      slug: 'little-bakers-pizza-night',
      hostSlug: 'little-bakers-co',
      categorySlug: 'kids',
      neighborhoodSlug: 'park-slope',
      name: 'Little bakers: pizza night',
      description:
        'Stretch the dough, spread the sauce, top it yourself: each kid makes a personal pizza and eats it hot at the counter. Grown-ups can stay for a slice and a coffee while they wait.',
    },
    {
      meetingPoint: 'Little Bakers Co. storefront, Park Slope.',
      included: 'Ingredients, aprons, and a pizza each.',
      durationMinutes: 90,
      accessibilityNotes: 'Step-free entrance. Nut-free kitchen.',
      ageRule: 'age_range',
      minAge: 5,
      maxAge: 11,
      prices: [
        { kind: 'adult', priceMinor: 0, usesSpace: false },
        { kind: 'child', priceMinor: 4200, usesSpace: true },
      ],
      slots: [slot(5, '17:00', 90, 12), slot(6, '16:00', 90, 12)],
    },
  ),
  experience(
    {
      slug: 'family-paddle-sunday',
      hostSlug: 'hudson-paddle-club',
      categorySlug: 'kids',
      neighborhoodSlug: 'tribeca',
      name: 'Family paddle Sunday',
      description:
        "Kids and grown-ups share a tandem kayak on calm water near the pier, with a guide close by. It's the gentlest way to try paddling, and the kids steer more than they think.",
    },
    {
      meetingPoint:
        'Pier 26 boathouse, Tribeca. The exact door is in your confirmation.',
      included:
        'Tandem kayaks, paddles, life jackets sized for kids, and a dry bag.',
      durationMinutes: 90,
      accessibilityNotes:
        "There's a ramp down to the dock. Guides help children and adults in and out.",
      outdoor: true,
      weatherPolicy: 'decided_before_start',
      weatherDecisionHours: 3,
      ageRule: 'minimum_age',
      minAge: 8,
      waiverDoc: hudsonWaiver,
      prices: [
        { kind: 'adult', priceMinor: 5500, usesSpace: true },
        { kind: 'child', priceMinor: 3500, usesSpace: true },
      ],
      slots: [slot(0, '10:00', 90, 16, [{ occurrence: 1, spacesLeft: 1 }])],
    },
  ),
  experience(
    {
      slug: 'kids-dumpling-saturday',
      hostSlug: 'steam-and-fold',
      categorySlug: 'kids',
      neighborhoodSlug: 'sunset-park',
      name: "Kids' dumpling Saturday",
      description:
        'Small hands are good at pleating. Kids learn two folds, fill their own dumplings, and eat what they make. One grown-up stays at the table and does not need a ticket.',
    },
    {
      meetingPoint: 'Steam & Fold, Eighth Avenue, Sunset Park.',
      included: 'Dough, fillings, aprons, and a lunch of their own dumplings.',
      durationMinutes: 90,
      accessibilityNotes: 'Step-free entrance. Low stools for small cooks.',
      ageRule: 'age_range',
      minAge: 6,
      maxAge: 12,
      prices: [
        { kind: 'adult', priceMinor: 0, usesSpace: false },
        { kind: 'child', priceMinor: 3600, usesSpace: true },
      ],
      slots: [slot(6, '10:00', 90, 8), slot(6, '13:00', 90, 8)],
    },
  ),
  experience(
    {
      slug: 'sew-a-hand-puppet',
      hostSlug: 'thimble-and-thread',
      categorySlug: 'kids',
      neighborhoodSlug: 'carroll-gardens',
      name: 'Sew a hand puppet',
      description:
        'Felt, buttons, and blunt needles: kids sew a hand puppet, then give it a name and a voice. Every child gets help with their first stitches.',
    },
    {
      meetingPoint: 'Thimble & Thread, Carroll Gardens.',
      included: 'Felt, thread, buttons, and blunt needles.',
      durationMinutes: 90,
      accessibilityNotes: 'Step-free entrance. Child-height tables.',
      ageRule: 'age_range',
      minAge: 6,
      maxAge: 12,
      prices: [
        { kind: 'adult', priceMinor: 0, usesSpace: false },
        { kind: 'child', priceMinor: 4000, usesSpace: true },
      ],
      slots: [slot(6, '11:00', 90, 10), slot(0, '11:00', 90, 10)],
    },
  ),
];
