import { describe, expect, it } from 'vitest';
import { id } from '../../tests/support/ids';
import {
  parsePhotoForm,
  photoAltSummary,
  photoFieldProblems,
  photoFormFields,
  photoNoticeCodes,
  photoNotices,
  photoProblemTexts,
  photoRefusalNotice,
  photoRefusalOf,
  photoRightsBasisLabels,
} from './photoForm';
import {
  photoLimits,
  photoRefusalCodes,
  photoRefusalMessage,
  photoRightsBases,
} from './photos';

// Behaviours under test, one per decision, branch or risk:
// - a described photo with its file and a rights basis is ready, and carries what addPhoto parses
// - a decorative photo needs no alt text and is read as decorative
// - each missing or blank part (file, alt text, rights, a licensed photo's licence and source) names its own field, in form order
// - a licensed photo's extra rights are required; any other basis ignores them
// - a text field past the raw limit is refused before the schema reads it
// - a file over the upload limit is refused by size alone; an empty file is a missing file
// - every refusal code has a notice, a sentence for the file field, and maps back from its notice
// - every field has a problem sentence, every notice a title, and every rights basis a label

const experienceId = id(1);
const png = new File([new Uint8Array(8)], 'bowl.png', { type: 'image/png' });

function formOf(fields: Record<string, unknown>) {
  return (name: string) => fields[name] ?? null;
}

const described = {
  photoFile: png,
  altText: 'A potter shaping a bowl',
  rightsBasis: 'ramble_owned',
};

describe('parsePhotoForm', () => {
  it('reads a described photo into the input addPhoto parses', () => {
    const result = parsePhotoForm(formOf(described), experienceId);

    expect(result).toEqual({
      status: 'ready',
      file: png,
      input: {
        experienceId,
        description: { decorative: false, altText: 'A potter shaping a bowl' },
        rights: {
          basis: 'ramble_owned',
          holder: null,
          license: null,
          sourceUrl: null,
        },
      },
    });
  });

  it('reads a decorative photo with no alt text', () => {
    const result = parsePhotoForm(
      formOf({
        photoFile: png,
        rightsBasis: 'host_agreement',
        decorative: 'on',
      }),
      experienceId,
    );

    expect(result).toMatchObject({
      status: 'ready',
      input: { description: { decorative: true, altText: null } },
    });
  });

  it("keeps a typed credit and a licensed photo's licence and source", () => {
    const result = parsePhotoForm(
      formOf({
        ...described,
        rightsBasis: 'licensed',
        rightsHolder: 'Ana Photographer',
        rightsLicense: 'Unsplash License',
        rightsSourceUrl: 'https://unsplash.com/photos/abc',
      }),
      experienceId,
    );

    expect(result).toMatchObject({
      status: 'ready',
      input: {
        rights: {
          basis: 'licensed',
          holder: 'Ana Photographer',
          license: 'Unsplash License',
          sourceUrl: 'https://unsplash.com/photos/abc',
        },
      },
    });
  });

  it.each([
    ['no file', { ...described, photoFile: undefined }, ['photoFile']],
    [
      'an empty file, which is what a browser posts for no choice',
      { ...described, photoFile: new File([], '') },
      ['photoFile'],
    ],
    [
      'a file field that is text',
      { ...described, photoFile: 'x' },
      ['photoFile'],
    ],
    ['blank alt text', { ...described, altText: '  ' }, ['altText']],
    [
      'alt text over the limit',
      { ...described, altText: 'a'.repeat(photoLimits.maxAltLength + 1) },
      ['altText'],
    ],
    ['no rights basis', { ...described, rightsBasis: '' }, ['rightsBasis']],
    [
      'an unknown rights basis',
      { ...described, rightsBasis: 'public_domain' },
      ['rightsBasis'],
    ],
    [
      'a licensed photo with no credit, licence or source',
      { ...described, rightsBasis: 'licensed' },
      ['rightsHolder', 'rightsLicense', 'rightsSourceUrl'],
    ],
    [
      'a source that is no web address',
      {
        ...described,
        rightsBasis: 'licensed',
        rightsHolder: 'Ana',
        rightsLicense: 'CC0',
        rightsSourceUrl: 'ftp://example.com',
      },
      ['rightsSourceUrl'],
    ],
    [
      'everything missing, in form order',
      { rightsBasis: '' },
      ['photoFile', 'altText', 'rightsBasis'],
    ],
    [
      'text past the raw limit, never read by the schema',
      { ...described, rightsHolder: 'h'.repeat(photoLimits.maxUrlLength + 1) },
      ['rightsHolder'],
    ],
  ])('names the fields to look at for %s', (_name, fields, expected) => {
    expect(parsePhotoForm(formOf(fields), experienceId)).toEqual({
      status: 'invalid',
      fields: expected,
    });
  });

  it('ignores a licence and source on a basis that needs neither', () => {
    const result = parsePhotoForm(
      formOf({
        ...described,
        rightsLicense: 'x'.repeat(10),
        rightsSourceUrl: 'nope',
      }),
      experienceId,
    );

    expect(result).toMatchObject({
      status: 'ready',
      input: { rights: { license: null, sourceUrl: null } },
    });
  });

  it('refuses a file over the upload limit by its size, without reading it', () => {
    const big = new File([], 'big.jpg');
    Object.defineProperty(big, 'size', {
      value: photoLimits.maxInputBytes + 1,
    });

    expect(
      parsePhotoForm(formOf({ ...described, photoFile: big }), experienceId),
    ).toEqual({ status: 'refused', code: 'too_large' });
  });

  it('names the fields before it judges the size of the file', () => {
    const big = new File([], 'big.jpg');
    Object.defineProperty(big, 'size', {
      value: photoLimits.maxInputBytes + 1,
    });

    expect(
      parsePhotoForm(
        formOf({ ...described, photoFile: big, altText: '' }),
        experienceId,
      ),
    ).toEqual({ status: 'invalid', fields: ['altText'] });
  });
});

describe('refusal notices', () => {
  it.each(photoRefusalCodes)('maps %s to a notice and back', (code) => {
    const notice = photoRefusalNotice(code);

    expect(photoNoticeCodes).toContain(notice);
    expect(photoRefusalOf(notice)).toBe(code);
    expect(photoNotices[notice].tone).toBe('danger');
  });

  it.each([null, 'photo_added', 'photo_invalid', 'photo_limit'] as const)(
    'maps %s to no refusal',
    (notice) => {
      expect(photoRefusalOf(notice)).toBeNull();
    },
  );

  it('puts the refusal reason on the file field and leaves the others as they are', () => {
    const texts = photoProblemTexts('too_small');

    expect(texts.photoFile).toBe(photoRefusalMessage('too_small'));
    expect(texts.altText).toBe(photoFieldProblems.altText);
    expect(photoProblemTexts(null)).toBe(photoFieldProblems);
  });
});

describe('copy', () => {
  it('names exactly the notice codes that have a notice', () => {
    expect([...photoNoticeCodes].sort()).toEqual(
      Object.keys(photoNotices).sort(),
    );
  });

  it('has a sentence for every form field', () => {
    expect([...photoFormFields].sort()).toEqual(
      Object.keys(photoFieldProblems).sort(),
    );
  });

  it('labels every rights basis', () => {
    expect([...photoRightsBases].sort()).toEqual(
      Object.keys(photoRightsBasisLabels).sort(),
    );
  });

  it.each([
    [{ decorative: true, altText: null }, 'Decorative, no alt text.'],
    [{ decorative: false, altText: 'A bowl' }, 'Alt text: A bowl'],
  ])('summarises the description of %j', (photo, expected) => {
    expect(photoAltSummary(photo)).toBe(expected);
  });
});
