import { describe, expect, it } from 'vitest';
import { photoLimits, photoStorageKey } from '@/lib/photos';
import { curated } from './fixtures';
import { experienceId } from './rows';
import {
  labelScale,
  missingTestPhotos,
  photoCoverageGaps,
  photoCoverageLine,
  photoStepFor,
  planTestPhotos,
  renderTestPhoto,
  testPhotoCount,
  testPhotoLongEdges,
  wrapLabel,
} from './testPhotos';

// Behaviours under test:
// - every curated experience gets 3 to 5 photos, positions 0 up, the same plan on every call
// - any three consecutive positions hold the small, the medium, and the ceiling long edge; no source is below
//   the ingest floor or above the stored ceiling, and no short edge is below the ingest minimum
// - ids, storage keys, and alt text are fixed by the slug, satisfy the photos CHECKs, and are unique
// - a rerun plans only the positions with no row
// - the label wraps on words, stays within the column count, and cuts a word longer than a line
// - the pixels are the same on every call, differ between experiences, and show the label
// - the fake provider is taken only by the local target, whatever else is set
// - coverage names an experience with no cover, fewer than three photos, or a photo without alt text

const sample = {
  slug: 'sunset-kayak-on-the-hudson',
  name: 'Sunset Kayak on the Hudson',
};

describe('planTestPhotos', () => {
  const plans = curated.experiences.map((fixture) => ({
    fixture,
    plan: planTestPhotos(fixture),
  }));

  it('gives every curated experience 3 to 5 photos from position 0', () => {
    for (const { plan } of plans) {
      expect(plan.length).toBeGreaterThanOrEqual(3);
      expect(plan.length).toBeLessThanOrEqual(5);
      expect(plan.map((photo) => photo.position)).toEqual(
        plan.map((_, index) => index),
      );
    }
  });

  it('uses all of 3, 4, and 5 photos somewhere in the curated set', () => {
    const counts = new Set(plans.map(({ plan }) => plan.length));
    expect([...counts].sort()).toEqual([3, 4, 5]);
  });

  it('plans the same photos on every call', () => {
    expect(planTestPhotos(sample)).toEqual(planTestPhotos(sample));
    expect(testPhotoCount(sample.slug)).toBe(planTestPhotos(sample).length);
  });

  it('holds all three long edges in the first three positions of every experience', () => {
    for (const { plan } of plans) {
      const edges = plan
        .slice(0, 3)
        .map((photo) => Math.max(photo.width, photo.height));
      expect([...edges].sort((a, b) => a - b)).toEqual([...testPhotoLongEdges]);
    }
  });

  it.each(
    plans.flatMap(({ fixture, plan }) =>
      plan.map((photo) => [fixture.slug, photo.position, photo] as const),
    ),
  )(
    'keeps %s position %i inside the ingest limits',
    (_slug, _position, photo) => {
      const long = Math.max(photo.width, photo.height);
      const short = Math.min(photo.width, photo.height);
      expect(long).toBeGreaterThanOrEqual(photoLimits.minLongEdge);
      expect(long).toBeLessThanOrEqual(photoLimits.storedEdge);
      expect(short).toBeGreaterThanOrEqual(photoLimits.minShortEdge);
      expect(photo.width * photo.height).toBeLessThanOrEqual(
        photoLimits.maxPixels,
      );
    },
  );

  it('makes the fourth and fifth photos portrait and the first three landscape', () => {
    const plan = plans.find(({ plan }) => plan.length === 5)?.plan ?? [];
    expect(plan.slice(0, 3).every((p) => p.width > p.height)).toBe(true);
    expect(plan.slice(3).every((p) => p.height > p.width)).toBe(true);
  });

  it('builds keys the database CHECK accepts, with unique ids and keys across the set', () => {
    const all = plans.flatMap(({ fixture, plan }) =>
      plan.map((photo) => ({ photo, id: experienceId(fixture.slug) })),
    );
    for (const { photo, id } of all) {
      expect(photo.storageKey).toBe(photoStorageKey(id, photo.photoId));
      expect(photo.photoId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(new Set(all.map((a) => a.photo.photoId)).size).toBe(all.length);
    expect(new Set(all.map((a) => a.photo.storageKey)).size).toBe(all.length);
  });

  it('writes alt text on every photo within the stored limit', () => {
    for (const { plan } of plans) {
      for (const photo of plan) {
        expect(photo.altText.trim().length).toBeGreaterThan(0);
        expect(photo.altText.length).toBeLessThanOrEqual(
          photoLimits.maxAltLength,
        );
      }
    }
    expect(
      planTestPhotos({ slug: 'x', name: 'N'.repeat(500) })[0]?.altText,
    ).toHaveLength(photoLimits.maxAltLength);
  });

  it('labels each photo with the experience, its place in the set, and its long edge', () => {
    const [first] = planTestPhotos(sample);
    expect(first?.label.at(-1)).toMatch(/^PHOTO 1\/\d \d{4}PX$/);
    expect(first?.label.slice(0, -1).join(' ')).toBe(
      'SUNSET KAYAK ON THE HUDSON',
    );
  });
});

describe('missingTestPhotos', () => {
  const plan = planTestPhotos(sample);

  it.each([
    [[], plan.length],
    [[0], plan.length - 1],
    [[0, 1, 2], plan.length - 3],
    [plan.map((p) => p.position), 0],
    [[7], plan.length],
  ])('with positions %j stored plans %i more', (stored, expected) => {
    expect(missingTestPhotos(plan, stored)).toHaveLength(expected);
  });

  it('keeps the planned order of what is left', () => {
    expect(missingTestPhotos(plan, [1]).map((p) => p.position)).toEqual(
      plan.map((p) => p.position).filter((p) => p !== 1),
    );
  });
});

describe('wrapLabel', () => {
  it.each([
    ['Sunset Kayak on the Hudson', 18, 3, ['SUNSET KAYAK ON', 'THE HUDSON']],
    ['Short', 18, 3, ['SHORT']],
    ['', 18, 3, []],
    ['A B C D', 3, 2, ['A B', 'C D']],
    ['Antidisestablishmentarianism', 10, 3, ['ANTIDISEST']],
    ['one two three four five six', 8, 2, ['ONE TWO', 'THREE']],
  ])(
    'wraps %j at %i columns and %i lines',
    (text, columns, maxLines, expected) => {
      expect(wrapLabel(text, columns, maxLines)).toEqual(
        expected.map((line) => line),
      );
    },
  );

  it('never exceeds the column count', () => {
    for (const line of wrapLabel(
      'Sunset Kayak on the Hudson and more',
      18,
      5,
    )) {
      expect(line.length).toBeLessThanOrEqual(18);
    }
  });
});

describe('renderTestPhoto', () => {
  const spec = {
    width: 320,
    height: 200,
    hue: 200,
    label: ['KAYAK', 'PHOTO 1/3 1600PX'],
  };

  it('returns three bytes per pixel, the same on every call', () => {
    const first = renderTestPhoto(spec);
    expect(first).toHaveLength(spec.width * spec.height * 3);
    expect(renderTestPhoto(spec)).toEqual(first);
  });

  it('differs by hue and by label', () => {
    expect(renderTestPhoto({ ...spec, hue: 20 })).not.toEqual(
      renderTestPhoto(spec),
    );
    expect(renderTestPhoto({ ...spec, label: ['OTHER'] })).not.toEqual(
      renderTestPhoto(spec),
    );
  });

  it('draws white label pixels only when there is a label', () => {
    const white = (pixels: Uint8Array) =>
      pixels.filter((value, index) => index % 3 === 0 && value === 255).length;
    expect(white(renderTestPhoto(spec))).toBeGreaterThan(0);
    expect(white(renderTestPhoto({ ...spec, label: [] }))).toBe(0);
  });

  it('flattens the gradient into at most twelve bands per channel', () => {
    const pixels = renderTestPhoto({ ...spec, label: [] });
    const reds = new Set<number>();
    for (let index = 0; index < pixels.length; index += 3) {
      reds.add(pixels[index] ?? 0);
    }
    expect(reds.size).toBeLessThanOrEqual(12);
    expect(reds.size).toBeGreaterThan(3);
  });

  it('keeps every label line inside the image at the smallest and largest sources', () => {
    for (const [width, height] of [
      [1067, 1600],
      [2400, 1600],
    ] as const) {
      const long = [
        'A'.repeat(18),
        'B'.repeat(18),
        'C'.repeat(18),
        'PHOTO 5/5 2400PX',
      ];
      expect(() =>
        renderTestPhoto({ width, height, hue: 0, label: long }),
      ).not.toThrow();
      expect(labelScale(width) * 6 * 18).toBeLessThanOrEqual(width);
    }
  });
});

describe('photoStepFor', () => {
  it.each([
    ['local', 'fake', true],
    ['local', 'vercel-blob', true],
    ['staging', 'vercel-blob', true],
    ['load-test', 'vercel-blob', true],
    ['production-demo', 'vercel-blob', true],
    ['staging', 'fake', false],
    ['load-test', 'fake', false],
    ['production-demo', 'fake', false],
  ] as const)('on %s with %s, runs: %s', (target, provider, run) => {
    expect(photoStepFor(target, provider).run).toBe(run);
  });

  it('says why the fake is skipped, naming the target', () => {
    const verdict = photoStepFor('production-demo', 'fake');
    expect(verdict.run ? '' : verdict.line).toContain('production-demo');
  });
});

describe('photoCoverageGaps', () => {
  const row = (
    slug: string,
    position: number,
    altText: string | null = 'alt',
    decorative = false,
  ) => ({
    experienceSlug: slug,
    position,
    decorative,
    altText,
  });
  const full = (slug: string) => [row(slug, 0), row(slug, 1), row(slug, 2)];

  it('is empty when each experience has a cover and three photos', () => {
    expect(photoCoverageGaps(['a', 'b'], [...full('a'), ...full('b')])).toEqual(
      [],
    );
  });

  it('names an experience with no photos at all, for both reasons', () => {
    expect(photoCoverageGaps(['a'], [])).toEqual([
      'a has no cover',
      'a has 0 photos, needs 3',
    ]);
  });

  it('names an experience whose lowest position is not 0', () => {
    expect(
      photoCoverageGaps(['a'], [row('a', 1), row('a', 2), row('a', 3)]),
    ).toEqual(['a has no cover']);
  });

  it('names an experience with two photos', () => {
    expect(photoCoverageGaps(['a'], [row('a', 0), row('a', 1)])).toEqual([
      'a has 2 photos, needs 3',
    ]);
  });

  it.each([[null], ['   '], ['']])(
    'names a photo whose alt text is %j',
    (alt) => {
      expect(
        photoCoverageGaps(['a'], [row('a', 0, alt), row('a', 1), row('a', 2)]),
      ).toEqual(['a has a photo without alt text']);
    },
  );

  it('accepts a decorative photo with no alt text', () => {
    expect(
      photoCoverageGaps(
        ['a'],
        [row('a', 0, null, true), row('a', 1), row('a', 2)],
      ),
    ).toEqual([]);
  });

  it('ignores photos of experiences it was not asked about', () => {
    expect(photoCoverageGaps(['a'], [...full('a'), row('z', 0)])).toEqual([]);
  });
});

describe('photoCoverageLine', () => {
  it('exits 0 with the count when there are no gaps', () => {
    expect(photoCoverageLine([], 25)).toEqual({
      code: 0,
      line: expect.stringContaining('25 experiences') as unknown,
    });
  });

  it('exits 1 and joins the gaps', () => {
    const result = photoCoverageLine(
      ['a has no cover', 'b has 1 photos, needs 3'],
      25,
    );
    expect(result.code).toBe(1);
    expect(result.line).toContain('a has no cover; b has 1 photos');
  });
});
