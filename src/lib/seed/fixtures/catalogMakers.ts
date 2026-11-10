import type { ExperienceFixture } from '../types';
import { experience } from './experiences';
import { slot } from './slots';

// Indoor classes for the curated catalog: crafts, cooking, wine and cocktails, food and coffee.
// Written fresh for Ramble in one editorial voice (docs/design/tone-checklist.md). Money lives in the
// price fields, never in the copy, and the sold-out and nearly full dates are set on purpose.

export const makerExperiences: ExperienceFixture[] = [
  experience(
    {
      slug: 'hand-built-planters',
      hostSlug: 'kiln-and-clay',
      categorySlug: 'ceramics-and-crafts',
      neighborhoodSlug: 'williamsburg',
      name: 'Hand-built planters for small windowsills',
      description:
        'Pinch, coil, and slab your way to a planter sized for the herbs you keep forgetting to water. Three hand-building methods get demoed, then you pick one and make it yours.',
    },
    {
      tier: 'moderate',
      meetingPoint: 'Kiln & Clay, second floor, Williamsburg.',
      included:
        'Clay, tools, glaze, firing, and a drainage saucer. Pickup is two weeks later.',
      durationMinutes: 120,
      accessibilityNotes:
        "The studio is up one flight of stairs and there's no elevator.",
      ageRule: 'minimum_age',
      minAge: 14,
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 7200, usesSpace: true }],
      slots: [slot(2, '18:30', 120, 8), slot(0, '13:00', 120, 8)],
    },
  ),
  experience(
    {
      slug: 'block-printed-tote-night',
      hostSlug: 'thimble-and-thread',
      categorySlug: 'ceramics-and-crafts',
      neighborhoodSlug: 'carroll-gardens',
      name: 'Block-printed tote night',
      description:
        'Carve a stamp from a soft block, ink it, and print a pattern of your own across a canvas tote. Come with a doodle in mind or leave with one; the teacher helps you turn either into a repeat.',
    },
    {
      meetingPoint:
        'Thimble & Thread, Carroll Gardens. The green door with the spool in the window.',
      included: 'Carving blocks, fabric ink, a canvas tote, and an apron.',
      durationMinutes: 150,
      accessibilityNotes:
        'Step-free entrance. The tables are standing height, and stools are available.',
      ageRule: 'minimum_age',
      minAge: 12,
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 5800, usesSpace: true }],
      slots: [slot(4, '18:30', 150, 10), slot(0, '17:00', 150, 10)],
    },
  ),
  experience(
    {
      slug: 'visible-mending-afternoon',
      hostSlug: 'thimble-and-thread',
      categorySlug: 'ceramics-and-crafts',
      neighborhoodSlug: 'carroll-gardens',
      name: 'Visible mending afternoon',
      description:
        'Bring a sweater with a hole in it and learn to fix it so the repair shows. Practice three stitches on a sample, then mend your own piece while the teacher goes around the table.',
    },
    {
      meetingPoint: 'Thimble & Thread, Carroll Gardens.',
      included:
        'Needles, thread, darning mushrooms, and cloth to practice on. Bring one thing to mend.',
      durationMinutes: 120,
      accessibilityNotes: 'Step-free entrance. Seated work at a shared table.',
      prices: [{ kind: 'adult', priceMinor: 4800, usesSpace: true }],
      slots: [
        slot(0, '14:00', 120, 6, [
          { occurrence: 0, spacesLeft: 0 },
          { occurrence: 1, spacesLeft: 2 },
        ]),
        slot(6, '13:00', 120, 6),
      ],
    },
  ),
  // In review: not shown to guests, and no sessions until the host confirms firing times.
  experience(
    {
      slug: 'glaze-your-own-dinner-plates',
      hostSlug: 'kiln-and-clay',
      categorySlug: 'ceramics-and-crafts',
      neighborhoodSlug: 'williamsburg',
      name: 'Glaze your own dinner plates',
      description:
        'Four bisque plates, a wall of glazes, and an afternoon to paint them. Waiting on the host to confirm firing times.',
    },
    {
      status: 'in_review',
      tier: 'strict',
      durationMinutes: 180,
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 11000, usesSpace: true }],
    },
  ),
  experience(
    {
      slug: 'sunday-sauce-for-a-crowd',
      hostSlug: 'salt-and-semolina',
      categorySlug: 'cooking',
      neighborhoodSlug: 'carroll-gardens',
      name: 'Sunday sauce for a crowd',
      description:
        'Build a pot of slow red sauce from scratch, with meatballs you roll yourself. It simmers while you make fresh bread, and you leave with a jar and the recipe.',
    },
    {
      tier: 'moderate',
      meetingPoint:
        'Salt & Semolina, Carroll Gardens. Ring the bell marked Kitchen.',
      included:
        'Ingredients, aprons, a meal at the table, and a jar of sauce to take home.',
      durationMinutes: 180,
      accessibilityNotes:
        'Step-free entrance. Most of the work is at a standing-height counter, and stools are available.',
      ageRule: 'minimum_age',
      minAge: 12,
      taxTreatment: 'unknown',
      prices: [{ kind: 'adult', priceMinor: 9500, usesSpace: true }],
      slots: [slot(0, '11:00', 180, 10), slot(0, '16:00', 180, 10)],
    },
  ),
  experience(
    {
      slug: 'bao-bun-basics',
      hostSlug: 'steam-and-fold',
      categorySlug: 'cooking',
      neighborhoodSlug: 'sunset-park',
      name: 'Bao bun basics',
      description:
        "Knead a soft dough, let it rise while you make the filling, then fold and steam your buns in the family's big bamboo steamers. Everyone eats what they make at the long table.",
    },
    {
      meetingPoint: 'Steam & Fold, Eighth Avenue, Sunset Park.',
      included: 'Dough, fillings, tea, and a box of buns to reheat at home.',
      durationMinutes: 120,
      accessibilityNotes: 'Step-free entrance. Seated work at a long table.',
      ageRule: 'minimum_age',
      minAge: 10,
      prices: [{ kind: 'adult', priceMinor: 6400, usesSpace: true }],
      slots: [slot(6, '15:00', 120, 8), slot(4, '18:30', 120, 8)],
    },
  ),
  experience(
    {
      slug: 'pickles-and-ferments-workshop',
      hostSlug: 'salt-and-semolina',
      categorySlug: 'cooking',
      neighborhoodSlug: 'carroll-gardens',
      name: 'Pickles and ferments workshop',
      description:
        'Salt a cabbage, brine a cucumber, and find out why the jar bubbles. Three small jars come home with you, plus a plan for when they get funky.',
    },
    {
      meetingPoint:
        'Salt & Semolina, Carroll Gardens. Ring the bell marked Kitchen.',
      included: 'Vegetables, salt, spices, three jars, and a printed guide.',
      durationMinutes: 90,
      accessibilityNotes:
        'Step-free entrance. Work happens at a counter, standing or on a stool.',
      ageRule: 'minimum_age',
      minAge: 12,
      prices: [{ kind: 'adult', priceMinor: 5200, usesSpace: true }],
      slots: [slot(3, '18:30', 90, 10), slot(6, '10:00', 90, 10)],
    },
  ),
  experience(
    {
      slug: 'stirred-not-shaken-cocktail-class',
      hostSlug: 'second-pour',
      categorySlug: 'wine-and-cocktails',
      neighborhoodSlug: 'lower-east-side',
      name: 'Stirred, not shaken: a cocktail class',
      description:
        "Make three classic drinks behind a real bar and learn why the stir matters. You'll pick up ice, ratios, and the small habits that make a drink taste right from a working bartender.",
    },
    {
      tier: 'moderate',
      meetingPoint:
        'Second Pour, Lower East Side. The class is in the back room.',
      included: 'Three cocktails, snacks, and a recipe card.',
      durationMinutes: 120,
      accessibilityNotes:
        'The back room is up a few steps. Ask the host about a seat at the front bar.',
      ageRule: 'twenty_one_plus',
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 7500, usesSpace: true }],
      slots: [slot(4, '19:00', 120, 12), slot(6, '17:00', 120, 12)],
    },
  ),
  experience(
    {
      slug: 'amaro-and-aperitivo-hour',
      hostSlug: 'second-pour',
      categorySlug: 'wine-and-cocktails',
      neighborhoodSlug: 'lower-east-side',
      name: 'Amaro and aperitivo hour',
      description:
        "Taste six bitter, herbal, slightly strange bottles and find the one you'll order next time. Small snacks and a short history lesson come with the pours.",
    },
    {
      meetingPoint: 'Second Pour, Lower East Side.',
      included: 'Six small pours, snacks, and tasting notes.',
      durationMinutes: 75,
      accessibilityNotes: 'Step-free entrance and seats with backs at the bar.',
      ageRule: 'twenty_one_plus',
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 5800, usesSpace: true }],
      slots: [slot(3, '18:30', 75, 12), slot(5, '18:00', 75, 12)],
    },
  ),
  // Sparse and sold out: one weekly slot, and the next three Wednesdays have no spaces left.
  experience(
    {
      slug: 'three-grapes-one-night',
      hostSlug: 'orchard-street-wine-room',
      categorySlug: 'wine-and-cocktails',
      neighborhoodSlug: 'lower-east-side',
      name: 'Three grapes, one night',
      description:
        "Three grapes, three producers of each, and a host who lines them up side by side. It's the quickest way to learn what a place and a pair of hands do to a wine.",
    },
    {
      tier: 'moderate',
      meetingPoint: 'Orchard Street Wine Room, Lower East Side.',
      included: 'Nine pours, bread, and olives.',
      durationMinutes: 90,
      accessibilityNotes: 'Step-free entrance from the sidewalk.',
      ageRule: 'twenty_one_plus',
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 6200, usesSpace: true }],
      slots: [
        slot(3, '19:00', 90, 10, [
          { occurrence: 0, spacesLeft: 0 },
          { occurrence: 1, spacesLeft: 0 },
          { occurrence: 2, spacesLeft: 0 },
        ]),
      ],
    },
  ),
  experience(
    {
      slug: 'dumpling-crawl-on-eighth-avenue',
      hostSlug: 'corner-table-tours',
      categorySlug: 'food-and-coffee',
      neighborhoodSlug: 'sunset-park',
      name: 'Dumpling crawl on Eighth Avenue',
      description:
        'Five stops, five kinds of dumpling, and a guide who knows who makes the best wrapper on the block. You walk about a mile between bites, and every stop is a small counter with a short menu.',
    },
    {
      meetingPoint: 'The corner of Eighth Avenue and 55th Street, Sunset Park.',
      included:
        'Every tasting, a guide, and a printed map for your next visit.',
      durationMinutes: 150,
      accessibilityNotes:
        'Flat streets, about a mile in all. Two stops have a step; tell the guide and they will swap them.',
      outdoor: true,
      weatherPolicy: 'rain_or_shine',
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 5600, usesSpace: true }],
      slots: [
        slot(6, '12:00', 150, 12),
        slot(0, '12:00', 150, 12, [{ occurrence: 1, spacesLeft: 1 }]),
      ],
    },
  ),
  experience(
    {
      slug: 'latte-art-basics',
      hostSlug: 'bean-counter-coffee-lab',
      categorySlug: 'food-and-coffee',
      neighborhoodSlug: 'williamsburg',
      name: 'Latte art basics',
      description:
        'Pull a shot, steam the milk, and pour until the heart shows up. Class is capped at six, so everyone gets a turn at the machine and plenty of practice cups.',
    },
    {
      meetingPoint: 'Bean Counter Coffee Lab, Williamsburg.',
      included: 'Espresso, milk, practice cups, and a coffee to take with you.',
      durationMinutes: 60,
      accessibilityNotes: 'Step-free entrance and bar seating with backs.',
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 4000, usesSpace: true }],
      slots: [slot(6, '09:30', 60, 6), slot(3, '17:30', 60, 6)],
    },
  ),
  experience(
    {
      slug: 'home-espresso-clinic',
      hostSlug: 'bean-counter-coffee-lab',
      categorySlug: 'food-and-coffee',
      neighborhoodSlug: 'williamsburg',
      name: 'Home espresso clinic',
      description:
        'Bring your questions and your grinder settings. The roaster walks through dialing in, cleaning, and why your shots taste sour, using the machines in the lab.',
    },
    {
      meetingPoint: 'Bean Counter Coffee Lab, Williamsburg.',
      included: 'Practice shots and a bag of beans.',
      durationMinutes: 75,
      accessibilityNotes: 'Step-free entrance and bar seating with backs.',
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 3500, usesSpace: true }],
      slots: [slot(0, '10:00', 75, 8)],
    },
  ),
  experience(
    {
      slug: 'cheese-counter-tasting',
      hostSlug: 'corner-table-tours',
      categorySlug: 'food-and-coffee',
      neighborhoodSlug: 'carroll-gardens',
      name: 'Cheese counter tasting',
      description:
        'Six cheeses, two breads, and a cheesemonger who will tell you what to buy for Friday night. You meet at a cheese counter on Court Street in Carroll Gardens.',
    },
    {
      tier: 'moderate',
      meetingPoint:
        'The cheese counter on Court Street, Carroll Gardens. Look for the blue awning.',
      included: 'Six cheeses, bread, pickles, and a small wedge to take home.',
      durationMinutes: 75,
      accessibilityNotes:
        'Step-free entrance. Tasting is at a standing counter.',
      taxTreatment: 'taxable',
      prices: [{ kind: 'adult', priceMinor: 4600, usesSpace: true }],
      slots: [slot(4, '18:00', 75, 10), slot(6, '16:00', 75, 10)],
    },
  ),
];
