import { describe, expect, it } from 'vitest';
import {
  guideOutcomeFor,
  guideRedirect,
  isGuideEntry,
  parseGuideForm,
  settleGuide,
} from './editorialGuides';
import { experienceLimits } from './experienceEditor';
import { newExperienceValues } from './experienceEditor';

// Behaviours under test, one per decision, branch or risk:
// - only a guide-only experience has links to set here
// - the link-out is required and both addresses must be http(s) with a host; a blank affiliate address is none
// - an address over the limit is refused unread and named, so no rule walks it
// - the stored content is kept whole and only the two links replace what it had; an entry no longer guide-only settles to a refusal
// - a refusal from the save names only this form's fields; the outcomes go back to the entry, or to the list when it is gone or not a guide

const id = '00000000-0000-4000-8000-000000000001';
const form = (fields: Record<string, string>) => (name: string) =>
  fields[name] ?? null;
const links = {
  linkOutUrl: 'https://host.example.com/classes',
  affiliateUrl: 'https://host.example.com/classes?ref=ramble',
};
const content = newExperienceValues({
  categoryId: id,
  neighborhoodId: id,
  cancellationTierId: id,
});

describe('isGuideEntry', () => {
  it.each([
    ['guide_only', true],
    ['live', false],
    ['draft', false],
  ] as const)('%s is %s', (status, expected) => {
    expect(isGuideEntry(status)).toBe(expected);
  });
});

describe('parseGuideForm', () => {
  it('reads both addresses', () => {
    expect(parseGuideForm(form(links))).toEqual({ ok: true, value: links });
  });

  it('reads a blank affiliate address as none', () => {
    expect(
      parseGuideForm(form({ linkOutUrl: links.linkOutUrl, affiliateUrl: ' ' })),
    ).toEqual({
      ok: true,
      value: { linkOutUrl: links.linkOutUrl, affiliateUrl: null },
    });
  });

  it.each([
    [
      'no link-out address',
      { affiliateUrl: links.affiliateUrl },
      ['linkOutUrl'],
    ],
    [
      'a link-out that is not http',
      { linkOutUrl: 'ftp://host.example.com' },
      ['linkOutUrl'],
    ],
    [
      'a link-out with credentials',
      { linkOutUrl: 'https://user:pw@host.example.com' },
      ['linkOutUrl'],
    ],
    [
      'an affiliate address that is not a link',
      { ...links, affiliateUrl: 'not a link' },
      ['affiliateUrl'],
    ],
    [
      'both wrong',
      { linkOutUrl: 'x', affiliateUrl: 'y' },
      ['linkOutUrl', 'affiliateUrl'],
    ],
  ])('refuses %s and names the fields', (_label, fields, named) => {
    expect(parseGuideForm(form(fields))).toEqual({ ok: false, fields: named });
  });

  it('refuses an address over the limit without reading it', () => {
    const long = `https://host.example.com/${'a'.repeat(experienceLimits.url)}`;
    expect(parseGuideForm(form({ ...links, linkOutUrl: long }))).toEqual({
      ok: false,
      fields: ['linkOutUrl'],
    });
  });
});

describe('settleGuide', () => {
  it('replaces only the two links in the stored content', () => {
    const settled = settleGuide({ status: 'guide_only', content }, links);
    expect(settled).toEqual({
      status: 'ready',
      content: { ...content, ...links },
    });
  });

  it('settles an entry that went live to not_a_guide', () => {
    expect(settleGuide({ status: 'live', content }, links)).toEqual({
      status: 'not_a_guide',
    });
  });
});

describe('guideOutcomeFor and guideRedirect', () => {
  it('names only the fields this form has when the save refuses', () => {
    expect(
      guideOutcomeFor({
        status: 'invalid',
        fields: ['description', 'affiliateUrl'],
      }),
    ).toEqual({ status: 'invalid', fields: ['affiliateUrl'] });
  });

  it.each(['updated', 'unchanged', 'not_found', 'reference_missing'] as const)(
    'passes %s through',
    (status) => {
      expect(guideOutcomeFor({ status })).toEqual({ status });
    },
  );

  it.each([
    [{ status: 'updated' }, `/ops/editorial/guides/${id}?notice=updated`],
    [{ status: 'unchanged' }, `/ops/editorial/guides/${id}?notice=unchanged`],
    [
      { status: 'reference_missing' },
      `/ops/editorial/guides/${id}?notice=reference_missing`,
    ],
    [{ status: 'not_found' }, '/ops/editorial/guides?notice=not_found'],
    [{ status: 'not_a_guide' }, '/ops/editorial/guides?notice=not_a_guide'],
    [
      { status: 'invalid', fields: ['linkOutUrl'] },
      `/ops/editorial/guides/${id}?notice=invalid&fields=linkOutUrl`,
    ],
  ] as const)('%j goes to %s', (outcome, href) => {
    expect(guideRedirect(id, outcome)).toBe(href);
  });
});
