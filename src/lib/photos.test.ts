import { describe, expect, it } from 'vitest';
import {
  blurDataUrlFrom,
  blurDataUrlPattern,
  GuestPhotoSchema,
  NewPhotoSchema,
  nextPhotoPosition,
  PhotoRightsSchema,
  photoAccessFor,
  photoActorFor,
  photoLimits,
  photoRefusalCodes,
  photoRefusalMessage,
  photoStorageKey,
  refusalForHeader,
  refusalForImageStage,
  refusalForStoredCopy,
  refusalForUpload,
} from './photos';

// Behaviours under test, one per decision, branch or risk:
// - an upload is refused by size alone: empty, over the limit; the limit itself passes
// - a decoder failure is an unsupported format at the header stage and a corrupt file at the re-encode stage
// - a re-encoded copy is refused over the stored cap; the cap itself passes
// - the blur placeholder is a data URL, refused when empty or over its length cap
// - the actor is staff (ops before admin), a host owner, or nobody, from roles alone
// - access: staff are told a missing experience is missing, a host owner gets the refusal for a missing one
// - a header is refused for format, missing size, frames, either edge, and area, each at its boundary
// - the next position is the lowest free one and is null once the experience is full
// - alt text is required unless decorative; a decorative photo carries none; blank and long alt text are refused
// - rights: licensed needs holder, licence, and a web link; the other bases take only a credit
// - every refusal code has copy
// - a guest photo row reads, and one with an unusable blur placeholder does not
// - the storage key is built from the two ids

const experienceId = '3f2b8a40-5c1d-4e6f-9a7b-1c2d3e4f5a6b';
const header = (overrides: Partial<Parameters<typeof refusalForHeader>[0]>) =>
  refusalForHeader({
    format: 'jpeg',
    width: 2000,
    height: 1500,
    pages: 1,
    ...overrides,
  });

describe('refusalForUpload', () => {
  it.each([
    [0, 'corrupt'],
    [1, null],
    [photoLimits.maxInputBytes, null],
    [photoLimits.maxInputBytes + 1, 'too_large'],
  ])('%i bytes gives %s', (byteLength, expected) => {
    expect(refusalForUpload(byteLength)).toBe(expected);
  });
});

describe('refusalForImageStage', () => {
  it.each([
    ['inspect', 'unsupported_format'],
    ['reencode', 'corrupt'],
  ] as const)('a decoder failure at %s gives %s', (stage, expected) => {
    expect(refusalForImageStage(stage)).toBe(expected);
  });
});

describe('refusalForStoredCopy', () => {
  it.each([
    [0, null],
    [photoLimits.maxStoredBytes, null],
    [photoLimits.maxStoredBytes + 1, 'too_large'],
  ])('%i bytes gives %s', (byteLength, expected) => {
    expect(refusalForStoredCopy(byteLength)).toBe(expected);
  });
});

describe('blurDataUrlFrom', () => {
  const prefix = 'data:image/jpeg;base64,';
  const longestBytes =
    Math.floor((photoLimits.maxBlurLength - prefix.length) / 4) * 3;

  it('encodes the bytes as a jpeg data URL that the stored pattern accepts', () => {
    const url = blurDataUrlFrom(new Uint8Array([1, 2, 3]));

    expect(url).toBe('data:image/jpeg;base64,AQID');
    expect(url).toMatch(new RegExp(blurDataUrlPattern));
  });

  it('keeps the longest placeholder that still fits the length cap', () => {
    const url = blurDataUrlFrom(new Uint8Array(longestBytes));

    // Base64 grows in steps of four characters, so the cap itself may sit one short of a step.
    const longestLength =
      prefix.length +
      Math.floor((photoLimits.maxBlurLength - prefix.length) / 4) * 4;
    expect(url?.length).toBe(longestLength);
    expect(longestLength).toBeLessThanOrEqual(photoLimits.maxBlurLength);
  });

  it.each([
    ['empty', 0],
    ['one group of three bytes over the cap', longestBytes + 3],
    [
      'more bytes than the cap allows in any encoding',
      photoLimits.maxBlurLength + 1,
    ],
  ])('refuses a placeholder that is %s', (_name, byteLength) => {
    expect(blurDataUrlFrom(new Uint8Array(byteLength))).toBeNull();
  });
});

describe('photoActorFor', () => {
  it.each([
    [['ops'], { kind: 'staff', role: 'ops' }],
    [['admin'], { kind: 'staff', role: 'admin' }],
    [['admin', 'ops'], { kind: 'staff', role: 'ops' }],
    [['host_owner', 'admin'], { kind: 'staff', role: 'admin' }],
    [['host_owner'], { kind: 'host_owner' }],
    [['host_staff'], null],
    [['guest'], null],
    [[], null],
  ])('%j gives %j', (roles, expected) => {
    expect(photoActorFor(roles)).toEqual(expected);
  });
});

describe('photoAccessFor', () => {
  const hostId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  it.each([
    [{ kind: 'staff', role: 'ops' }, hostId, { outcome: 'staff', role: 'ops' }],
    [{ kind: 'staff', role: 'admin' }, null, { outcome: 'experience_missing' }],
    [{ kind: 'host_owner' }, hostId, { outcome: 'host_owner', hostId }],
    [{ kind: 'host_owner' }, null, { outcome: 'refused' }],
  ] as const)('%j with host %s gives %j', (actor, host, expected) => {
    expect(photoAccessFor(actor, host)).toEqual(expected);
  });
});

describe('refusalForHeader', () => {
  it.each([
    ['a jpeg', {}, null],
    ['a png', { format: 'png' }, null],
    ['a webp', { format: 'webp' }, null],
    ['a gif', { format: 'gif' }, 'unsupported_format'],
    ['a heif', { format: 'heif' }, 'unsupported_format'],
    ['an unknown format', { format: undefined }, 'unsupported_format'],
    ['no width', { width: undefined }, 'corrupt'],
    ['no height', { height: undefined }, 'corrupt'],
    ['two frames', { pages: 2 }, 'animated'],
    ['no page count', { pages: undefined }, null],
    ['a long edge of exactly 1,600', { width: 1600, height: 1000 }, null],
    ['a long edge of 1,599', { width: 1599, height: 1000 }, 'too_small'],
    [
      'a portrait long edge of 1,599',
      { width: 1000, height: 1599 },
      'too_small',
    ],
    ['a short edge of exactly 400', { width: 3000, height: 400 }, null],
    ['a short edge of 399', { width: 3000, height: 399 }, 'too_small'],
    ['a long edge of exactly 8,192', { width: 8192, height: 4000 }, null],
    ['a long edge of 8,193', { width: 8193, height: 1000 }, 'too_many_pixels'],
    ['a tall photo of 8,193', { width: 1000, height: 8193 }, 'too_many_pixels'],
    ['exactly 50 million pixels', { width: 8000, height: 6250 }, null],
    [
      '50 million and 1 pixels',
      { width: 8000, height: 6251 },
      'too_many_pixels',
    ],
  ])('%s', (_name, overrides, expected) => {
    expect(header(overrides)).toBe(expected);
  });
});

describe('nextPhotoPosition', () => {
  const full = Array.from(
    { length: photoLimits.maxPerExperience },
    (_, i) => i,
  );

  it.each([
    ['an empty gallery', [], 0],
    ['positions 0 to 2', [0, 1, 2], 3],
    ['a gap left by a removal', [0, 2, 3], 1],
    ['unordered positions', [2, 0, 1], 3],
    [
      'one place left at the end',
      full.slice(0, -1),
      photoLimits.maxPerExperience - 1,
    ],
    ['one place left in the middle', full.filter((i) => i !== 7), 7],
    ['a full gallery', full, null],
  ])('%s', (_name, taken, expected) => {
    expect(nextPhotoPosition(taken)).toBe(expected);
  });
});

describe('NewPhotoSchema', () => {
  const rights = { basis: 'ramble_owned' };
  const parse = (input: object) =>
    NewPhotoSchema.safeParse({ experienceId, rights, ...input });

  it('reads alt text, trimmed', () => {
    const result = parse({
      description: { decorative: false, altText: '  A potter shaping clay  ' },
    });

    expect(result.data?.description).toEqual({
      decorative: false,
      altText: 'A potter shaping clay',
    });
  });

  it('reads a decorative photo as having no alt text, whatever was sent', () => {
    const result = parse({
      description: { decorative: true, altText: 'ignored' },
    });

    expect(result.data?.description).toEqual({
      decorative: true,
      altText: null,
    });
  });

  it.each([
    ['no description', {}],
    ['neither alt text nor the decorative flag', { description: {} }],
    [
      'no alt text on a non-decorative photo',
      { description: { decorative: false } },
    ],
    [
      'blank alt text',
      { description: { decorative: false, altText: ' \n\t ' } },
    ],
    [
      'alt text over the limit',
      {
        description: {
          decorative: false,
          altText: 'a'.repeat(photoLimits.maxAltLength + 1),
        },
      },
    ],
    [
      'a malformed experience id',
      {
        experienceId: 'nope',
        description: { decorative: false, altText: 'ok' },
      },
    ],
  ])('refuses %s', (_name, input) => {
    expect(parse(input).success).toBe(false);
  });

  it('accepts alt text of exactly the limit', () => {
    const altText = 'a'.repeat(photoLimits.maxAltLength);

    expect(parse({ description: { decorative: false, altText } }).success).toBe(
      true,
    );
  });

  it('refuses a missing rights record', () => {
    expect(
      NewPhotoSchema.safeParse({
        experienceId,
        description: { decorative: true },
      }).success,
    ).toBe(false);
  });
});

describe('PhotoRightsSchema', () => {
  const licensed = {
    basis: 'licensed',
    holder: 'Ana Photographer',
    license: 'Unsplash License',
    sourceUrl: 'https://unsplash.com/photos/abc123',
  };

  it('reads a licensed photo with all three fields', () => {
    expect(PhotoRightsSchema.parse(licensed)).toEqual(licensed);
  });

  it.each(['holder', 'license', 'sourceUrl'])(
    'refuses a licensed photo with no %s',
    (field) => {
      expect(
        PhotoRightsSchema.safeParse({ ...licensed, [field]: undefined })
          .success,
      ).toBe(false);
    },
  );

  it.each([
    ['a javascript link', 'javascript:alert(1)'],
    ['a relative link', '/photos/abc'],
    ['a link over the length limit', `https://example.com/${'a'.repeat(2048)}`],
  ])('refuses %s as the source', (_name, sourceUrl) => {
    expect(
      PhotoRightsSchema.safeParse({ ...licensed, sourceUrl }).success,
    ).toBe(false);
  });

  it.each(['host_agreement', 'ramble_owned'])(
    '%s needs no credit, and drops a licence and source sent with it',
    (basis) => {
      expect(
        PhotoRightsSchema.parse({
          basis,
          license: 'x',
          sourceUrl: 'https://example.com/',
        }),
      ).toEqual({ basis, holder: null, license: null, sourceUrl: null });
    },
  );

  it('keeps a credit on a host agreement', () => {
    expect(
      PhotoRightsSchema.parse({
        basis: 'host_agreement',
        holder: 'The Studio',
      }),
    ).toMatchObject({ holder: 'The Studio' });
  });

  it('refuses an unknown basis', () => {
    expect(PhotoRightsSchema.safeParse({ basis: 'found_online' }).success).toBe(
      false,
    );
  });
});

describe('photoRefusalMessage', () => {
  it.each(photoRefusalCodes)('has copy for %s', (code) => {
    expect(photoRefusalMessage(code).length).toBeGreaterThan(10);
  });
});

describe('GuestPhotoSchema', () => {
  const row = {
    id: '7d1c9b1e-0a53-4c3a-8d58-0d0e1f7a9b21',
    experienceId,
    position: 0,
    url: 'https://abc123.public.blob.vercel-storage.com/public/photos/a/b.jpg',
    width: 2000,
    height: 1500,
    decorative: false,
    altText: 'A potter at work',
    blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
  };

  it('reads a row', () => {
    expect(GuestPhotoSchema.parse(row)).toEqual(row);
  });

  it.each([
    [
      'a blur placeholder that is not a data URL',
      { blurDataUrl: 'https://x.example/a.jpg' },
    ],
    [
      'a script as the blur placeholder',
      { blurDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
    ],
    ['a javascript URL', { url: 'javascript:alert(1)' }],
    ['a negative position', { position: -1 }],
  ])('refuses %s', (_name, override) => {
    expect(GuestPhotoSchema.safeParse({ ...row, ...override }).success).toBe(
      false,
    );
  });
});

describe('blurDataUrlPattern', () => {
  it('matches the data URL shape ingest produces and nothing wider', () => {
    const pattern = new RegExp(blurDataUrlPattern);

    expect(pattern.test('data:image/jpeg;base64,/9j/4AAQ+SkZ==')).toBe(true);
    expect(pattern.test('data:image/png;base64,iVBOR')).toBe(false);
    expect(pattern.test('data:image/jpeg;base64,')).toBe(false);
    expect(pattern.test('data:image/jpeg;base64,abc"onerror=')).toBe(false);
  });
});

describe('photoStorageKey', () => {
  it('is public, under photos, and made of the two ids', () => {
    expect(photoStorageKey('exp-id', 'photo-id')).toBe(
      'public/photos/exp-id/photo-id.jpg',
    );
  });
});
