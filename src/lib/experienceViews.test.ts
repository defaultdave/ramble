import { describe, expect, it } from 'vitest';
import { id } from '../../tests/support/ids';
import { parseAuditEntry } from './audit';
import {
  experienceCreatedEntry,
  experienceUpdatedEntry,
} from './experienceAudit';
import {
  buildExperienceChoices,
  buildExperienceEditView,
  experienceFieldProblems,
  experienceNoticeHref,
  experienceNotices,
  experiencePath,
  experienceStatusLabels,
  experienceStatusOptions,
  newExperienceValues,
  parseExperienceFilters,
  parseExperienceNotice,
  parseProblemFields,
  type ExperienceContent,
} from './experienceEditor';
import type { HostExperience } from './catalog';

// Behaviours under test, one per decision, branch or risk:
// - every status has a label and a filter option, and the editor's paths hold the id
// - the filters read from the address: a known status, host and category, and nothing else
// - the choices carry names, and a tier shows its refund terms
// - a saved experience becomes the editor's view with its host's name
// - a notice, the fields it names and the href an action redirects to round-trip, and an unknown one is null
// - every form field has a problem sentence, every notice a tone
// - the audit rows name the group that changed, carry the new money and tax, and always pass the
//   audit log's own checks, even when every field changed

const offered = {
  hosts: [id(1), id(2)].map((value) => ({ value, label: 'Host' })),
  categories: [id(3), id(4)].map((value) => ({ value, label: 'Category' })),
};

describe('status labels and options', () => {
  it('offers one filter option per status, in the schema order, with its label', () => {
    expect(experienceStatusOptions.map((option) => option.value)).toEqual([
      'draft',
      'in_review',
      'live',
      'paused',
      'guide_only',
    ]);
    expect(experienceStatusOptions[1]).toEqual({
      value: 'in_review',
      label: experienceStatusLabels.in_review,
    });
  });

  it('puts the id in the experience path', () => {
    expect(experiencePath(id(7))).toBe(`/ops/experiences/${id(7)}`);
  });
});

describe('parseExperienceFilters', () => {
  it('reads a known status, host and category', () => {
    expect(
      parseExperienceFilters(
        { status: 'live', host: id(2), category: id(3) },
        offered,
      ),
    ).toEqual({ status: 'live', hostId: id(2), categoryId: id(3) });
  });

  it.each<[string, Record<string, string | string[]>]>([
    ['nothing', {}],
    ['an unknown status', { status: 'archived' }],
    ['a host the page does not offer', { host: id(9) }],
    ['a category the page does not offer', { category: 'nope' }],
    ['a repeated host', { host: [id(1), id(2)] }],
  ])('reads %s as no filter', (_label, query) => {
    expect(parseExperienceFilters(query, offered)).toEqual({
      status: null,
      hostId: null,
      categoryId: null,
    });
  });
});

describe('buildExperienceChoices', () => {
  const choices = buildExperienceChoices({
    hosts: [{ id: id(1), name: 'Clay Corner' }],
    categories: [{ id: id(3), slug: 'classes', name: 'Classes' }],
    neighborhoods: [{ id: id(5), slug: 'soho', name: 'SoHo' }],
    cancellationTiers: [
      {
        id: id(6),
        key: 'flexible',
        name: 'Flexible',
        fullRefundHoursBefore: 24,
        isDefault: true,
      },
    ],
    waivers: [{ id: id(7), title: 'Clay waiver', version: 2 }],
  });

  it('labels each choice by name', () => {
    expect(choices.hosts).toEqual([{ value: id(1), label: 'Clay Corner' }]);
    expect(choices.categories).toEqual([{ value: id(3), label: 'Classes' }]);
    expect(choices.neighborhoods).toEqual([{ value: id(5), label: 'SoHo' }]);
  });

  it('shows a tier with its refund terms and a waiver with its version', () => {
    expect(choices.cancellationTiers).toEqual([
      {
        value: id(6),
        label: 'Flexible: Free cancellation up to 24 hours before',
      },
    ]);
    expect(choices.waivers).toEqual([
      { value: id(7), label: 'Clay waiver (version 2)' },
    ]);
  });
});

describe('buildExperienceEditView', () => {
  it('carries the host name, the status and the content with its prices', () => {
    const content = newExperienceValues({
      categoryId: id(3),
      neighborhoodId: id(5),
      cancellationTierId: id(6),
    });
    const experience = {
      ...content,
      id: id(10),
      hostId: id(1),
      status: 'live',
      createdAt: new Date('2026-10-01T00:00:00Z'),
      priceOptions: [
        {
          id: id(11),
          experienceId: id(10),
          kind: 'adult',
          priceMinor: 8500,
          usesSpace: true,
        },
      ],
      cancellationTier: {
        id: id(6),
        key: 'flexible',
        name: 'Flexible',
        fullRefundHoursBefore: 24,
        isDefault: true,
      },
    } as unknown as HostExperience;

    expect(buildExperienceEditView(experience, 'Clay Corner')).toMatchObject({
      id: id(10),
      hostId: id(1),
      hostName: 'Clay Corner',
      status: 'live',
      content: { adultPriceMinor: 8500, childPriceMinor: null },
    });
  });
});

describe('notices', () => {
  it('reads a known notice and refuses an unknown one or a repeated one', () => {
    expect(parseExperienceNotice('updated')).toBe('updated');
    expect(parseExperienceNotice('exploded')).toBeNull();
    expect(parseExperienceNotice(['updated', 'created'])).toBeNull();
    expect(parseExperienceNotice(undefined)).toBeNull();
  });

  it('reads only known fields, in form order', () => {
    expect(parseProblemFields('slug,name,bogus')).toEqual(['name', 'slug']);
    expect(parseProblemFields(undefined)).toEqual([]);
  });

  it('builds an address that reads back, and leaves out an empty field list', () => {
    const href = experienceNoticeHref('/ops/experiences/x', 'invalid', [
      'name',
      'adultPrice',
    ]);

    const params = new URL(href, 'https://ramble.test').searchParams;
    expect(params.get('notice')).toBe('invalid');
    expect(parseProblemFields(params.get('fields') ?? undefined)).toEqual([
      'name',
      'adultPrice',
    ]);
    expect(experienceNoticeHref('/ops/experiences', 'created')).toBe(
      '/ops/experiences?notice=created',
    );
  });

  it('has a sentence for every field and a title for every notice', () => {
    expect(
      Object.values(experienceFieldProblems).every((text) => text.length > 0),
    ).toBe(true);
    expect(
      Object.values(experienceNotices).every(({ title }) => title.length > 0),
    ).toBe(true);
  });
});

describe('the experience audit rows', () => {
  const after: ExperienceContent = {
    ...newExperienceValues({
      categoryId: id(3),
      neighborhoodId: id(5),
      cancellationTierId: id(6),
    }),
    adultPriceMinor: 8500,
    taxTreatment: 'taxable',
  };

  it('names the host on a creation', () => {
    expect(experienceCreatedEntry(id(1), id(2), id(3))).toEqual({
      actorKind: 'user',
      actorId: id(1),
      action: 'experience.created',
      subjectKind: 'experience',
      subjectId: id(2),
      details: { host_id: id(3) },
    });
  });

  it('reports a text change as its group alone, with no value', () => {
    const entry = experienceUpdatedEntry(id(1), id(2), ['name', 'slug'], after);

    expect(entry.details).toEqual({ changed_text: true });
  });

  it('carries the new prices, tax treatment and tier when they change', () => {
    const entry = experienceUpdatedEntry(
      id(1),
      id(2),
      ['adultPriceMinor', 'taxTreatment', 'cancellationTierId'],
      after,
    );

    expect(entry.details).toEqual({
      changed_prices: true,
      adult_price_minor: 8500,
      child_price_minor: null,
      changed_tax: true,
      tax_treatment: 'taxable',
      changed_cancellation: true,
      cancellation_tier_id: id(6),
    });
  });

  it('stays inside the audit log limits when every field changed', () => {
    const everything = Object.keys(after) as (keyof ExperienceContent)[];

    const entry = experienceUpdatedEntry(id(1), id(2), everything, after);

    expect(() => parseAuditEntry(entry)).not.toThrow();
  });
});
