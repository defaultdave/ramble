import { describe, expect, it } from 'vitest';
import type { HostExperience } from './catalog';
import {
  buildHostExperiences,
  hostExperiencesResult,
  refundWindowLabel,
} from './hostExperiences';

// Behaviours under test, one per decision, branch, or risk:
// - a row carries the experience's name, its status in words with the status's tone, and its waiver
// - prices are one line per option in the order given, adult first, a whole dollar without cents
// - the cancellation line names the tier and its refund window, with hour, hours, and the start itself worded apart
// - an experience with no price options shows none, and a host with no experiences shows no rows
// - a request is signed out, refused (not an owner), or shows the rows, empty ones included

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function experience(overrides: Partial<HostExperience> = {}): HostExperience {
  return {
    id: id(1),
    hostId: id(2),
    categoryId: id(3),
    neighborhoodId: id(4),
    cancellationTierId: id(5),
    slug: 'sunset-kayak',
    name: 'Sunset kayak',
    description: null,
    meetingPoint: null,
    included: null,
    durationMinutes: 90,
    accessibilityNotes: null,
    status: 'live',
    outdoor: false,
    weatherPolicy: null,
    weatherDecisionHours: null,
    ageRule: 'all_ages',
    minAge: null,
    maxAge: null,
    taxTreatment: 'taxable',
    waiverRequired: false,
    waiverDocumentId: null,
    linkOutUrl: null,
    affiliateUrl: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    priceOptions: [
      {
        id: id(6),
        experienceId: id(1),
        kind: 'adult',
        priceMinor: 6500,
        usesSpace: true,
      },
      {
        id: id(7),
        experienceId: id(1),
        kind: 'child',
        priceMinor: 3250,
        usesSpace: true,
      },
    ],
    cancellationTier: {
      id: id(5),
      key: 'flexible',
      name: 'Flexible',
      fullRefundHoursBefore: 24,
      isDefault: true,
    },
    ...overrides,
  };
}

describe('buildHostExperiences', () => {
  it('shows an experience as its name, status, prices, cancellation and waiver', () => {
    expect(buildHostExperiences([experience()]).rows).toEqual([
      {
        id: id(1),
        name: 'Sunset kayak',
        statusLabel: 'Live',
        statusTone: 'success',
        prices: ['Adult $65', 'Child $32.50'],
        cancellation: 'Flexible: full refund up to 24 hours before',
        waiver: 'No waiver',
      },
    ]);
  });

  it.each([
    ['draft', 'Draft', 'neutral'],
    ['in_review', 'In review', 'info'],
    ['paused', 'Paused', 'warning'],
    ['guide_only', 'Guide only', 'info'],
  ] as const)('shows %s as %s', (status, label, tone) => {
    const [row] = buildHostExperiences([experience({ status })]).rows;
    expect(row).toMatchObject({ statusLabel: label, statusTone: tone });
  });

  it('says when a waiver is required', () => {
    const [row] = buildHostExperiences([
      experience({ waiverRequired: true, waiverDocumentId: id(9) }),
    ]).rows;
    expect(row?.waiver).toBe('Guests accept a waiver');
  });

  it('has no prices for an experience with no options', () => {
    const [row] = buildHostExperiences([experience({ priceOptions: [] })]).rows;
    expect(row?.prices).toEqual([]);
  });

  it('has no rows for a host with no experiences', () => {
    expect(buildHostExperiences([]).rows).toEqual([]);
  });
});

describe('refundWindowLabel', () => {
  it.each([
    [0, 'full refund until the session starts'],
    [1, 'full refund up to 1 hour before'],
    [48, 'full refund up to 48 hours before'],
  ])('%i hours: %s', (hours, label) => {
    expect(refundWindowLabel(hours)).toBe(label);
  });
});

describe('hostExperiencesResult', () => {
  it.each([
    [
      'nobody signed in',
      { kind: 'signed_out' } as const,
      null,
      { status: 'signed_out' },
    ],
    [
      'a signed-in person who owns no host',
      { kind: 'not_a_host_owner' } as const,
      null,
      { status: 'refused' },
    ],
    [
      'an owner with no experiences',
      { kind: 'owner', hostId: 'h1' } as const,
      [],
      { status: 'ok', view: { rows: [] } },
    ],
  ])('%s', (_case, access, read, expected) => {
    expect(hostExperiencesResult(access, read)).toEqual(expected);
  });
});
