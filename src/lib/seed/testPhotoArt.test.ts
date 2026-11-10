import { describe, expect, it } from 'vitest';
import {
  artColorAt,
  artFor,
  categoryMotifs,
  motifs,
  palettes,
} from './testPhotoArt';
import { renderTestPhoto } from './testPhotoImage';
import { curated } from './fixtures';

// Behaviours under test:
// - every curated category has a motif, and every motif is used
// - the art is a function of the category, the slug seed, and the position: the same on every call, and different when any changes
// - every motif paints some points, and only in its palette
// - the palettes are the brand's: each has an ink that reads on its ground
// - an experience with art renders a picture with the label still in white, and different from the plain gradient

const grid = Array.from({ length: 41 }, (_, i) => (i - 20) / 20);

const painted = (motif: (typeof motifs)[number], variant = 0) => {
  const art = artFor(
    Object.keys(categoryMotifs).find((k) => categoryMotifs[k] === motif),
    1,
    variant,
  );
  if (!art) throw new Error(`no art for ${motif}`);
  const points = grid.flatMap((y) => grid.map((x) => artColorAt(art, x, y)));
  return { art, points };
};

describe('artFor', () => {
  it('has a motif for every curated category and uses every motif', () => {
    expect(curated.categories.every((c) => c.slug in categoryMotifs)).toBe(
      true,
    );
    expect(new Set(Object.values(categoryMotifs))).toEqual(new Set(motifs));
  });

  it('returns nothing for a category with no motif', () => {
    expect(artFor('unknown', 3, 0)).toBeUndefined();
    expect(artFor(undefined, 3, 0)).toBeUndefined();
  });

  it('is the same on every call and varies with the seed and the position', () => {
    expect(artFor('kids', 7, 1)).toEqual(artFor('kids', 7, 1));
    expect(artFor('kids', 7, 1)).not.toEqual(artFor('kids', 8, 1));
    expect(artFor('kids', 7, 1)).not.toEqual(artFor('kids', 7, 2));
    expect(artFor('kids', 7, 3)?.variant).toBe(0);
  });

  it('draws on every palette across seeds', () => {
    const used = new Set(
      Array.from(
        { length: palettes.length },
        (_, seed) => artFor('kids', seed, 0)?.palette.name,
      ),
    );
    expect(used.size).toBe(palettes.length);
  });
});

describe('artColorAt', () => {
  it.each(motifs.map((m) => [m] as const))(
    '%s paints some points in its palette and leaves others to the ground, in every variant',
    (motif) => {
      for (const variant of [0, 1, 2]) {
        const { art, points } = painted(motif, variant);
        const colors = points.filter((c) => c !== undefined);
        expect(colors.length).toBeGreaterThan(40);
        expect(points.length - colors.length).toBeGreaterThan(40);
        const palette = [art.palette.ink, art.palette.accent, art.palette.pop];
        for (const color of colors) expect(palette).toContain(color);
      }
    },
  );

  it('draws a different shape in a different variant', () => {
    expect(painted('blocks', 0).points).not.toEqual(
      painted('blocks', 1).points,
    );
  });
});

describe('palettes', () => {
  const luminance = ([r, g, b]: readonly [number, number, number]) =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;

  it.each(palettes.map((p) => [p.name, p] as const))(
    '%s keeps its ink readable on its ground',
    (_name, palette) => {
      expect(
        Math.abs(luminance(palette.ink) - luminance(palette.ground)),
      ).toBeGreaterThan(90);
    },
  );
});

describe('renderTestPhoto with art', () => {
  const art = artFor('outdoors', 5, 0);
  const spec = {
    width: 320,
    height: 200,
    hue: 200,
    label: ['KAYAK', 'PHOTO 1/3 1600PX'],
  };

  it('is the same on every call and differs from the plain gradient', () => {
    const first = renderTestPhoto({ ...spec, art });
    expect(renderTestPhoto({ ...spec, art })).toEqual(first);
    expect(first).not.toEqual(renderTestPhoto(spec));
  });

  it('still draws the label in white, and the motif in the palette colors', () => {
    const pixels = renderTestPhoto({ ...spec, art });
    const at = (i: number) => [pixels[i], pixels[i + 1], pixels[i + 2]];
    const colors = new Set<string>();
    for (let i = 0; i < pixels.length; i += 3) colors.add(at(i).join(','));
    expect(colors.has('255,255,255')).toBe(true);
    expect(colors.has((art?.palette.accent ?? []).join(','))).toBe(true);
  });

  it('keeps the label at the foot, below the motif, at the smallest and largest sources', () => {
    for (const [width, height] of [
      [1067, 1600],
      [2400, 1600],
    ] as const) {
      expect(() =>
        renderTestPhoto({
          width,
          height,
          hue: 0,
          art,
          label: [
            'A'.repeat(18),
            'B'.repeat(18),
            'C'.repeat(18),
            'PHOTO 5/5 2400PX',
          ],
        }),
      ).not.toThrow();
    }
  });
});
