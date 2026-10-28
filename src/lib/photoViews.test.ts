import { describe, expect, it } from 'vitest';
import type { GuestPhoto } from './photos';
import { photoLimits } from './photos';
import {
  CoverLookupSchema,
  coverLookupIds,
  coversByExperience,
  photoView,
  withCovers,
} from './photoViews';

// Behaviours under test, one per decision, branch or risk:
// - a photo's view carries its address, size, and blur placeholder, and its alt text unless it is decorative, which gets an empty alt
// - a cover lookup takes at most the limit and refuses a malformed ID
// - the IDs of a lookup are lower-case, each once, and in one order, whatever order they came in
// - the cover of an experience is its lowest position, whatever order the photos arrive in, and an experience with no photo has none
// - a card gets its experience's cover, or no image when it has none, and keeps everything else

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const photo = (
  experienceId: string,
  position: number,
  overrides: Partial<GuestPhoto> = {},
): GuestPhoto => ({
  id: id(100 + position),
  experienceId,
  position,
  url: `https://store.example/public/photos/${experienceId}/${String(position)}.jpg`,
  width: 1600,
  height: 1000,
  decorative: false,
  altText: `Photo ${String(position)}`,
  blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
  ...overrides,
});

describe('photoView', () => {
  it('keeps the address, size, placeholder, and alt text', () => {
    expect(photoView(photo(id(1), 0))).toEqual({
      src: `https://store.example/public/photos/${id(1)}/0.jpg`,
      width: 1600,
      height: 1000,
      alt: 'Photo 0',
      blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    });
  });

  it('gives a decorative photo an empty alt, which a screen reader skips', () => {
    expect(
      photoView(photo(id(1), 0, { decorative: true, altText: null })).alt,
    ).toBe('');
  });
});

describe('CoverLookupSchema', () => {
  it('takes the most the limit names', () => {
    const ids = Array.from({ length: photoLimits.maxCoverLookups }, (_, n) =>
      id(n),
    );
    expect(CoverLookupSchema.safeParse(ids).success).toBe(true);
    expect(CoverLookupSchema.safeParse([...ids, id(9999)]).success).toBe(false);
  });

  it('refuses an ID that is not a uuid', () => {
    expect(CoverLookupSchema.safeParse(['not-a-uuid']).success).toBe(false);
  });
});

describe('coverLookupIds', () => {
  it('lower-cases, drops repeats, and sorts', () => {
    expect(coverLookupIds([id(3), id(1).toUpperCase(), id(1), id(2)])).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
  });

  it('gives the same list for the same IDs in another order', () => {
    expect(coverLookupIds([id(2), id(1)])).toEqual(
      coverLookupIds([id(1), id(2)]),
    );
  });
});

describe('coversByExperience', () => {
  it('picks the lowest position of each experience, in any arrival order', () => {
    const covers = coversByExperience([
      photo(id(1), 3),
      photo(id(2), 1),
      photo(id(1), 1),
      photo(id(1), 2),
    ]);

    expect(covers.get(id(1))?.alt).toBe('Photo 1');
    expect(covers.get(id(2))?.alt).toBe('Photo 1');
    expect(covers.size).toBe(2);
  });

  it('has no entry for an experience with no photo', () => {
    expect(coversByExperience([]).get(id(1))).toBeUndefined();
  });
});

describe('withCovers', () => {
  const card = (n: number) => ({
    id: id(n),
    title: `Card ${String(n)}`,
    image: null,
  });

  it('sets the cover of each card and leaves the rest of it alone', () => {
    const covers = coversByExperience([photo(id(1), 0)]);

    const [first, second] = withCovers([card(1), card(2)], covers);

    expect(first).toMatchObject({ title: 'Card 1', image: { alt: 'Photo 0' } });
    expect(second).toEqual(card(2));
  });
});
