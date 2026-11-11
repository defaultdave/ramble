// The photo pool manifest: how many generated pictures each curated experience has, and the alt text
// that goes with each. The seed draws every picture itself from arithmetic (src/lib/seed/testPhotoArt.ts):
// one flat motif per category on a gradient ground, with the experience's name in white capitals on a
// dark band at the foot. They stand in for the photography Ramble's own team shoots, so each caption
// describes the illustration actually drawn (the motif, which of its three variants, the name, the
// format) and never a scene from the experience. The stored alt text opens with "Illustration:".
// Position 0 is the cover. Rights: Ramble owned, generated test image.

import { categoryMotifs, type Motif } from '../testPhotoArt';
import { curated } from './index';

export const photoPoolRights = {
  rightsBasis: 'ramble_owned',
  rightsHolder: 'Ramble (generated test image)',
} as const;

/** Pictures per experience, 3 to 5. Positions 0 to 2 are landscape and 3 and 4 portrait (testPhotos.ts). */
const photoCounts: Readonly<Record<string, number>> = {
  'sunset-kayak-on-the-hudson': 5,
  'kids-wheel-class': 3,
  'little-bakers-cookie-club': 3,
  'natural-wine-explained': 4,
  'hand-rolled-pasta-in-carroll-gardens': 5,
  'dumpling-folding-in-sunset-park': 3,
  'wheel-throwing-for-beginners': 4,
  'cast-iron-and-cobblestones': 3,
  'sunday-sound-bath': 3,
  'coffee-cupping-in-williamsburg': 3,
  'sourdough-mornings-at-rise-bakery': 3,
  'fresh-mozzarella-night': 3,
  'rooftop-sunrise-yoga': 3,
  'winter-paddle-series': 3,
  'hand-built-planters': 3,
  'block-printed-tote-night': 3,
  'visible-mending-afternoon': 3,
  'glaze-your-own-dinner-plates': 3,
  'sunday-sauce-for-a-crowd': 3,
  'bao-bun-basics': 3,
  'pickles-and-ferments-workshop': 3,
  'stirred-not-shaken-cocktail-class': 3,
  'amaro-and-aperitivo-hour': 3,
  'three-grapes-one-night': 3,
  'dumpling-crawl-on-eighth-avenue': 5,
  'latte-art-basics': 3,
  'home-espresso-clinic': 3,
  'cheese-counter-tasting': 3,
  'lower-east-side-stoop-stories': 3,
  'sunset-park-side-streets-walk': 3,
  'park-slope-brownstone-walk': 3,
  'waterfront-bike-ride-from-sunset-park': 3,
  'twilight-pedal-along-the-waterfront': 3,
  'learn-to-kayak-in-the-cove': 3,
  'saturday-morning-at-the-stoop-garden': 5,
  'candlelit-restorative-yoga': 3,
  'garden-meditation-morning': 3,
  'little-bakers-pizza-night': 3,
  'family-paddle-sunday': 3,
  'kids-dumpling-saturday': 3,
  'sew-a-hand-puppet': 3,
  'letterpress-card-night-at-quill-and-ink': 3,
  'bookbinding-afternoon-at-quill-and-ink': 3,
  'oyster-shucking-lesson-at-old-pier': 3,
  'martinis-and-a-short-history': 3,
  'saturday-easy-run-in-sunset-park': 3,
  'post-run-stretch-on-the-grass': 3,
  'long-table-supper-in-williamsburg': 3,
  'pie-crust-morning-in-williamsburg': 3,
  'kids-pizza-saturday-in-carroll-gardens': 3,
};

const landscapePositions = 3;

// What testPhotoArt.ts draws for each motif, by variant (the position in the set, modulo three).
// Nothing here says left, right, upper or lower: testPhotoArt.ts mirrors the whole motif for about half the
// slugs, so a direction would be false for those pictures. A test holds the line.
const scenes: Readonly<Record<Motif, readonly [string, string, string]>> = {
  vessel: [
    'A flat, round-bellied vessel with a wide rim and a small foot, in one solid color.',
    'A flat, round-bellied vessel with a wide rim and a small foot, banded in two alternating colors.',
    'A flat, round-bellied vessel with a wide rim and a small foot, in one solid color again, as in the first view.',
  ],
  pot: [
    'A flat cooking pot with a dark lid bar and three wavy lines of steam rising from it.',
    'A flat cooking pot with a dark lid bar and three wavy lines of steam, the steam curling a different way.',
    'A flat cooking pot with a dark lid bar, its body in a bright color and three wavy lines of steam.',
  ],
  street: [
    'A skyline of eight flat buildings, tall and short in alternating colors, dotted with small lit windows.',
    'A skyline of eight flat buildings, tall and short in alternating colors, with the heights rearranged.',
    'A skyline of eight flat buildings, tall and short in alternating colors, in a third arrangement of heights.',
  ],
  glass: [
    'A flat stemmed glass with the bowl filled in one color and a small bubble floating off the bowl.',
    'A flat stemmed glass with the bowl filled in one color and a small bubble floating a little farther from the bowl.',
    'A flat stemmed glass with the bowl in two colors and a small bubble floating farther still from the bowl.',
  ],
  cup: [
    'A flat cup on a saucer line with a round handle on one side and two wisps of steam rising from it.',
    'A flat cup on a saucer line with a round handle on one side and two wisps of steam curling another way.',
    'A flat cup on a saucer line with a round handle on one side and two wisps of steam in a third curl.',
  ],
  'sun-water': [
    'A round sun just off center, with bands of wavy, striped water.',
    'A round sun at the center, with bands of wavy, striped water.',
    'A round sun just off center on the opposite side from the first view, with bands of wavy, striped water.',
  ],
  rings: [
    'A round target of concentric rings in alternating colors.',
    'A round target of concentric rings in alternating colors, the color order moved along one step.',
    'A round target of concentric rings in alternating colors, the color order moved along two steps.',
  ],
  blocks: [
    'Three flat building blocks, one stacked across the other two, and a ball, in three colors.',
    'Three flat building blocks, one stacked across the other two, and a ball, with the colors swapped round.',
    'Three flat building blocks, one stacked across the other two, and a ball, in a third color order.',
  ],
};

const categoryOf = new Map(curated.experiences.map((e) => [e.slug, e]));

function captionsFor(slug: string, count: number): string[] {
  const experience = categoryOf.get(slug);
  const motif = experience
    ? categoryMotifs[experience.categorySlug]
    : undefined;
  if (!experience || !motif) return [];
  return Array.from({ length: count }, (_, position) => {
    const scene = scenes[motif][position % 3] ?? scenes[motif][0];
    const format = position < landscapePositions ? 'Landscape' : 'Portrait';
    return `${scene} Across the foot, a dark band carries the name ${experience.name} in white capitals. ${format} view ${String(position + 1)} of ${String(count)}.`;
  });
}

export const photoManifest: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    Object.entries(photoCounts).map(([slug, count]) => [
      slug,
      captionsFor(slug, count),
    ]),
  );
