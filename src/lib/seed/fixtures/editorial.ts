import { blocks, paragraphs } from '../richText';
import type {
  CollectionFixture,
  HomeModuleFixture,
  PageCopyFixture,
} from '../types';

// Editorial copy in Ramble's voice (docs/design/tone-checklist.md): a friend's recommendation, with a
// point of view, specific to the neighborhood, honest about money and rules, and no pressure.

export const collections: CollectionFixture[] = [
  {
    kind: 'pick',
    slug: 'rainy-day-sorted',
    title: 'Rainy day, sorted',
    summary: 'Indoor plans that beat staying in, picked by our editors.',
    intro: paragraphs(
      'Forecast says rain. Good: these are the plans we reach for when the sidewalks are empty and the studios are warm.',
      'Every one happens indoors, in a small group, with something to show for it at the end.',
    ),
    status: 'published',
    items: [
      {
        slug: 'hand-rolled-pasta-in-carroll-gardens',
        note: 'Dinner is the lesson, and the lesson is dinner.',
      },
      {
        slug: 'dumpling-folding-in-sunset-park',
        note: 'Three folds, a long table, and a box of frozen dumplings for later.',
      },
      {
        slug: 'wheel-throwing-for-beginners',
        note: 'You will make a mug. It may lean. You will love it anyway.',
      },
      { slug: 'natural-wine-explained', note: null },
      {
        slug: 'sunday-sound-bath',
        note: 'The quietest hour you will have all week.',
      },
      { slug: 'coffee-cupping-in-williamsburg', note: null },
    ],
  },
  {
    kind: 'pick',
    slug: 'slow-saturday-mornings',
    title: 'Slow Saturday mornings',
    summary: 'Start the weekend with something to do before noon.',
    intro: paragraphs(
      'The best Saturdays begin without an alarm and still get somewhere by ten. These are the mornings worth getting up for.',
    ),
    status: 'published',
    items: [
      {
        slug: 'kids-wheel-class',
        note: 'Bowls for breakfast, made by someone small.',
      },
      { slug: 'little-bakers-cookie-club', note: null },
      {
        slug: 'cast-iron-and-cobblestones',
        note: 'Flat, gentle, and full of detail.',
      },
      { slug: 'coffee-cupping-in-williamsburg', note: null },
      {
        slug: 'sourdough-mornings-at-rise-bakery',
        note: 'Booked with the bakery, not with Ramble.',
      },
    ],
  },
  {
    kind: 'pick',
    slug: 'golden-hour',
    title: 'Golden hour',
    summary: 'Plans timed for the best light of the day.',
    intro: paragraphs(
      'Late sun makes everything look better, including you in a life jacket. Pick a clear evening and go.',
    ),
    status: 'published',
    items: [
      {
        slug: 'sunset-kayak-on-the-hudson',
        note: 'The skyline goes pink behind you.',
      },
      { slug: 'cast-iron-and-cobblestones', note: null },
      // Paused, so a guest never sees it: the seed keeps it here to prove the read leaves it out.
      { slug: 'winter-paddle-series', note: null },
      { slug: 'natural-wine-explained', note: null },
    ],
  },
  {
    kind: 'pick',
    slug: 'date-night-downtown',
    title: 'Date night, downtown',
    summary: 'Still in draft.',
    intro: paragraphs('Three evenings out for two. Not ready to publish.'),
    status: 'draft',
    items: [
      { slug: 'natural-wine-explained', note: null },
      { slug: 'wheel-throwing-for-beginners', note: null },
      { slug: 'hand-rolled-pasta-in-carroll-gardens', note: null },
    ],
  },
  {
    kind: 'gift_guide',
    slug: 'gift-guide',
    title: 'Give a Saturday, not a sweater',
    summary:
      'Experiences to give for every kind of person. They pick the date; you look thoughtful.',
    intro: paragraphs(
      'A gift here is a plan, not a package. The person you give it to chooses the day, and you get the thanks.',
      'Each gift is valid for twelve months. If it goes unused, you are refunded in full.',
    ),
    status: 'published',
    items: [
      {
        slug: 'sunset-kayak-on-the-hudson',
        note: 'For the one who says they never get outside.',
      },
      {
        slug: 'wheel-throwing-for-beginners',
        note: 'For the one who has everything but a mug they made.',
      },
      {
        slug: 'natural-wine-explained',
        note: 'For the friend who always orders the second cheapest bottle.',
      },
      { slug: 'hand-rolled-pasta-in-carroll-gardens', note: null },
      {
        slug: 'sunday-sound-bath',
        note: 'For the person who needs to be told to rest.',
      },
      { slug: 'coffee-cupping-in-williamsburg', note: null },
    ],
  },
];

export const homeModules: HomeModuleFixture[] = [
  {
    kind: 'hero_search',
    enabled: true,
    heading: 'Something good to do this weekend',
    body: paragraphs(
      'Classes, walks, tastings, and trips from people who love this city. Book in a few taps.',
    ),
    collectionSlug: null,
  },
  {
    kind: 'category_rail',
    enabled: true,
    heading: 'Browse by category',
    body: null,
    collectionSlug: null,
  },
  {
    kind: 'picks',
    enabled: true,
    heading: null,
    body: null,
    collectionSlug: 'rainy-day-sorted',
  },
  {
    kind: 'gift_guide',
    enabled: true,
    heading: null,
    body: null,
    collectionSlug: 'gift-guide',
  },
  {
    kind: 'this_week',
    enabled: true,
    heading: 'On this week',
    body: null,
    collectionSlug: null,
  },
  {
    kind: 'reassurance',
    enabled: true,
    heading: null,
    body: paragraphs(
      'The price you see is the price you pay. There are no booking fees.',
      'Every experience states its cancellation terms, with a real date and time, before you pay.',
      'Your confirmation lands in your inbox within minutes, with a link to manage your booking.',
    ),
    collectionSlug: null,
  },
];

type CopyInput = {
  slug: string;
  heading: string;
  metaDescription: string;
  intro: string;
  body: string[];
};

function copy(
  kind: PageCopyFixture['kind'],
  input: CopyInput,
): PageCopyFixture {
  return {
    kind,
    slug: input.slug,
    heading: input.heading,
    metaDescription: input.metaDescription,
    intro: paragraphs(input.intro),
    body: blocks(...input.body),
  };
}

export const pageCopy: PageCopyFixture[] = [
  copy('category', {
    slug: 'ceramics-and-crafts',
    heading: 'Pottery and craft classes in Brooklyn',
    metaDescription:
      'Wheel throwing, hand building, and other make-it-yourself classes in small Brooklyn studios, with everything you need included.',
    intro:
      'Center some clay, make a mug, and take home something you can use. Studios keep groups small, and the teachers are patient with wobbly first bowls.',
    body: [
      'Most classes run two hours and include clay, tools, glazing, and firing. Your piece is ready for pickup a couple of weeks later, which gives you something to look forward to.',
      'You need no experience and nothing to bring. Wear clothes you do not mind getting a little muddy.',
    ],
  }),
  copy('category', {
    slug: 'cooking',
    heading: 'Cooking classes in Brooklyn',
    metaDescription:
      'Roll pasta in Carroll Gardens, fold dumplings in Sunset Park, and cook in real home kitchens with small groups and a meal at the end.',
    intro:
      'Roll pasta in Carroll Gardens, fold dumplings in Sunset Park, or stretch your own mozzarella. Small groups, real kitchens, and dinner more often than not.',
    body: [
      'These classes are taught by people who cook this food at home. You do the work with your own hands, and you eat what you make.',
      'Some bakeries and kitchens take bookings on their own sites. We list those too, clearly marked, so you can see everything in one place.',
    ],
  }),
  copy('category', {
    slug: 'walking-tours',
    heading: 'Walking tours in New York',
    metaDescription:
      'Small-group walks led by people who know the blocks: architecture, food, and the stories behind the streets. Rain or shine.',
    intro:
      'Slow loops with a guide who points out what you would walk past. Groups are small and the pace is easy.',
    body: [
      'Most walks run about ninety minutes and cover a mile or less. The meeting point and the route are on every page, along with notes on stairs and surfaces.',
      'Walks go ahead in the rain unless the page says otherwise, so bring a jacket.',
    ],
  }),
  copy('category', {
    slug: 'wine-and-cocktails',
    heading: 'Wine and cocktail classes in New York',
    metaDescription:
      'Tastings and classes for people who want to know what they are drinking: small groups, patient hosts, and no jargon. Guests are 21 and over.',
    intro:
      'Learn what you like and how to ask for it. Hosts pour small, explain plainly, and keep the groups friendly.',
    body: [
      'Every class here is for guests 21 and over. The booker confirms that at checkout, and hosts may check ID at the door.',
      'Tastings include food, so nobody is drinking on an empty stomach.',
    ],
  }),
  copy('category', {
    slug: 'food-and-coffee',
    heading: 'Food and coffee tastings in Brooklyn',
    metaDescription:
      'Taste your way through a neighborhood: coffee cuppings, tasting tables, and snack crawls led by the people who make the food.',
    intro:
      'Come hungry. These are tastings where the person running the room made the thing on your plate.',
    body: [
      'Tastings run an hour or two and usually end with something to take home. Hosts are happy to talk about allergies before you book, so ask.',
    ],
  }),
  copy('category', {
    slug: 'outdoors',
    heading: 'Outdoor trips around New York',
    metaDescription:
      'Kayaking, biking, and other time on the water and the trails, with guides, gear, and clear weather policies.',
    intro:
      'Get on the water, get on a bike, get out of the apartment. Guides bring the gear and the know-how.',
    body: [
      'Outdoor trips say plainly what happens in bad weather: some run in light rain, and some are decided a few hours before the start. If the host cancels, you are refunded in full.',
      'Some hosts ask you to accept a waiver at checkout. You can read it first on the experience page.',
    ],
  }),
  copy('category', {
    slug: 'wellness',
    heading: 'Yoga, sound baths, and slow hours',
    metaDescription:
      'Quiet classes in small studios: sound baths, gentle yoga, and other ways to spend an hour doing nothing on purpose.',
    intro:
      'An hour set aside, in a room built for it. You do not need to be flexible, only willing to stop for a bit.',
    body: [
      'Studios provide mats and blankets. Pages say whether you can sit in a chair or lie down, and whether the building has steps.',
    ],
  }),
  copy('category', {
    slug: 'kids',
    heading: 'Things to do with kids in Brooklyn',
    metaDescription:
      'Hands-on classes for kids in small groups: pottery, baking, and more, with the age range and the adult rule on every page.',
    intro:
      'Classes where kids do the making. Every page says the age range and whether a grown-up needs a ticket.',
    body: [
      'Where a class is for children, you choose how many children and how many adults come. You add each child’s age at checkout, so the host knows who is in the room.',
    ],
  }),
  copy('neighborhood', {
    slug: 'williamsburg',
    heading: 'Things to do in Williamsburg',
    metaDescription:
      'Pottery, coffee, and kids’ classes in Williamsburg, from small studios you can walk to from the L.',
    intro:
      'Pottery wheels, coffee labs, and a studio where children get their own clay. Williamsburg is the easiest place to make something on a Saturday.',
    body: [
      'Most of the studios here are within a few blocks of the Bedford Avenue stop. Weekend classes fill early, so look a week ahead.',
    ],
  }),
  copy('neighborhood', {
    slug: 'carroll-gardens',
    heading: 'Things to do in Carroll Gardens',
    metaDescription:
      'Cooking classes in Carroll Gardens brownstone kitchens, with small groups and a meal at the end.',
    intro:
      'Brownstone kitchens, long tables, and dinner you made yourself. Carroll Gardens is where Brooklyn teaches you to cook.',
    body: [
      'Classes happen in people’s working kitchens, so groups are small. The meeting point and the doorbell are in your confirmation.',
    ],
  }),
  copy('neighborhood', {
    slug: 'park-slope',
    heading: 'Things to do in Park Slope',
    metaDescription:
      'Kids’ baking classes and bakery mornings in Park Slope, close to the park and the 7th Avenue shops.',
    intro:
      'Bakery mornings and kids’ classes a short stroll from the park. Park Slope does slow Saturdays well.',
    body: [
      'Some of the bakeries here take bookings on their own sites. We mark those clearly and link you straight to them.',
    ],
  }),
  copy('neighborhood', {
    slug: 'sunset-park',
    heading: 'Things to do in Sunset Park',
    metaDescription:
      'Dumpling classes and quiet studio hours in Sunset Park, with family-run hosts and plenty of room to sit down.',
    intro:
      'Family kitchens and quiet studios, a few blocks from Eighth Avenue. Come hungry, or come to rest.',
    body: [
      'Classes here are taught by people who have lived in the neighborhood for years. Expect long tables, steady hands, and a lot of food.',
    ],
  }),
  copy('neighborhood', {
    slug: 'tribeca',
    heading: 'Things to do in Tribeca',
    metaDescription:
      'Kayak on the Hudson at sunset, or walk the cast-iron blocks with a guide. Tribeca plans, with meeting points at the river.',
    intro:
      'The river on one side, old warehouse blocks on the other. Paddle out at sunset or walk the streets with someone who knows the buildings.',
    body: [
      'Meeting points are at the pier or on a named corner, and the exact door is in your confirmation. Streets here are flat and easy to walk.',
    ],
  }),
  copy('neighborhood', {
    slug: 'lower-east-side',
    heading: 'Things to do on the Lower East Side',
    metaDescription:
      'Wine tastings and evening classes on the Lower East Side, in small rooms with patient hosts.',
    intro:
      'Small rooms, late starts, and hosts who pour with a point of view. The Lower East Side is made for an evening out that begins with learning something.',
    body: [
      'Most experiences here run after work. Tastings are for guests 21 and over and include food.',
    ],
  }),
];
