import { z } from 'zod';
import type { CacheChange } from './cacheTags';
import { cancellationTerms } from './cancellation';
import {
  ageRules,
  experienceRuleIssues,
  experienceStatuses,
  HttpUrlSchema,
  SlugSchema,
  taxTreatments,
  weatherPolicies,
  WriteIdSchema,
  type CancellationTier,
  type Category,
  type HostExperience,
  type Neighborhood,
} from './catalog';
import { parseSingle, type SelectOption } from './filters';
import { priceInputTextOrNull, priceMinorFromText } from './money';
import {
  changedFields,
  fieldsFromIssues,
  formHas,
  formText,
  inFieldOrder,
  oversizedFields,
  slugFor,
  type FormGetter,
  type NoticeText,
} from './opsForm';
import { pickKnown } from './pickKnown';
import type { GuestPhoto } from './photos';
import { maxSessionMinutes } from './sessions';
import {
  parseStatusParam,
  type StatusFilterOption,
  type StatusTone,
} from './statusBadge';
import type { TableQuery } from './tableQuery';
import { requiredText, wholeNumberText } from './text';

// The experience editor for ops: every content field and the two price options of an experience.
// Status is not edited here (the review queue and pause own it), and the cancellation tier is
// chosen from the shared tiers, never edited.

export const experienceLimits = {
  name: 120,
  slug: 80,
  description: 5000,
  meetingPoint: 500,
  included: 1000,
  accessibilityNotes: 1000,
  url: 2000,
  maxAge: 120,
  /** A week: the weather call is made at most this long before the start. */
  weatherDecisionHours: 168,
  /** $99,999.99 in cents, far past any listing and well inside an integer column. */
  priceMinor: 9_999_999,
  /** A field longer than this is refused unread, so no rule walks an unbounded string. */
  rawField: 6000,
} as const;

export const experiencesPageSize = 25;

/** The most rows a read of choices returns, so a read cannot grow with the catalog. */
export const experienceChoiceLimits = { hosts: 500, waivers: 200 } as const;

export const experiencesPath = '/ops/experiences';
export const newExperiencePath = '/ops/experiences/new';

export function experiencePath(experienceId: string): string {
  return `${experiencesPath}/${experienceId}`;
}

export type ExperienceStatus = (typeof experienceStatuses)[number];

export const experienceStatusLabels = {
  draft: 'Draft',
  in_review: 'In review',
  live: 'Live',
  paused: 'Paused',
  guide_only: 'Guide only',
} as const satisfies Record<ExperienceStatus, string>;

export const experienceStatusTones = {
  draft: 'neutral',
  in_review: 'info',
  live: 'success',
  paused: 'warning',
  guide_only: 'info',
} as const satisfies Record<ExperienceStatus, StatusTone>;

export const experienceStatusOptions: readonly StatusFilterOption[] =
  experienceStatuses.map((status) => ({
    value: status,
    label: experienceStatusLabels[status],
  }));

/** What the editor saves: the experience's own fields and its price options, flat so a diff is a comparison per key. */
export type ExperienceContent = {
  name: string;
  slug: string;
  description: string | null;
  meetingPoint: string | null;
  included: string | null;
  accessibilityNotes: string | null;
  durationMinutes: number | null;
  categoryId: string;
  neighborhoodId: string;
  cancellationTierId: string;
  outdoor: boolean;
  weatherPolicy: (typeof weatherPolicies)[number] | null;
  weatherDecisionHours: number | null;
  ageRule: (typeof ageRules)[number];
  minAge: number | null;
  maxAge: number | null;
  taxTreatment: (typeof taxTreatments)[number];
  waiverRequired: boolean;
  waiverDocumentId: string | null;
  linkOutUrl: string | null;
  affiliateUrl: string | null;
  adultPriceMinor: number | null;
  childPriceMinor: number | null;
  childUsesSpace: boolean;
};
export type ExperienceContentField = keyof ExperienceContent;

export type ExperienceCreateInput = ExperienceContent & { hostId: string };

/** Every name the form posts: the content fields, with the two prices under their own names. */
export const experienceFormFields = [
  'hostId',
  'name',
  'slug',
  'description',
  'meetingPoint',
  'included',
  'accessibilityNotes',
  'durationMinutes',
  'categoryId',
  'neighborhoodId',
  'cancellationTierId',
  'outdoor',
  'weatherPolicy',
  'weatherDecisionHours',
  'ageRule',
  'minAge',
  'maxAge',
  'taxTreatment',
  'waiverRequired',
  'waiverDocumentId',
  'linkOutUrl',
  'affiliateUrl',
  'adultPrice',
  'childPrice',
  'childUsesSpace',
] as const;
export type ExperienceFormField = (typeof experienceFormFields)[number];

export type ExperienceFormResult<T> =
  { ok: true; value: T } | { ok: false; fields: ExperienceFormField[] };

/** A price field as the form shows it for editing, empty for none. */
export function priceFieldValue(minor: number | null): string {
  return priceInputTextOrNull(minor) ?? '';
}

const PriceSchema = z.string().transform((text, ctx) => {
  const minor = priceMinorFromText(text);
  if (minor === undefined || minor > experienceLimits.priceMinor) {
    ctx.addIssue({ code: 'custom', message: 'A price' });
    return 0;
  }
  return minor;
});

const FieldsSchema = z.strictObject({
  hostId: WriteIdSchema.optional(),
  name: requiredText(experienceLimits.name),
  slug: SlugSchema.optional(),
  description: requiredText(experienceLimits.description).optional(),
  meetingPoint: requiredText(experienceLimits.meetingPoint).optional(),
  included: requiredText(experienceLimits.included).optional(),
  accessibilityNotes: requiredText(
    experienceLimits.accessibilityNotes,
  ).optional(),
  durationMinutes: wholeNumberText(1, maxSessionMinutes).optional(),
  categoryId: WriteIdSchema,
  neighborhoodId: WriteIdSchema,
  cancellationTierId: WriteIdSchema,
  weatherPolicy: z.enum(weatherPolicies).optional(),
  weatherDecisionHours: wholeNumberText(
    1,
    experienceLimits.weatherDecisionHours,
  ).optional(),
  ageRule: z.enum(ageRules),
  minAge: wholeNumberText(0, experienceLimits.maxAge).optional(),
  maxAge: wholeNumberText(0, experienceLimits.maxAge).optional(),
  taxTreatment: z.enum(taxTreatments),
  waiverDocumentId: WriteIdSchema.optional(),
  linkOutUrl: HttpUrlSchema.max(experienceLimits.url).optional(),
  affiliateUrl: HttpUrlSchema.max(experienceLimits.url).optional(),
  adultPrice: PriceSchema.optional(),
  childPrice: PriceSchema.optional(),
});

const textFields = [
  'hostId',
  'name',
  'slug',
  'description',
  'meetingPoint',
  'included',
  'accessibilityNotes',
  'durationMinutes',
  'categoryId',
  'neighborhoodId',
  'cancellationTierId',
  'weatherPolicy',
  'weatherDecisionHours',
  'ageRule',
  'minAge',
  'maxAge',
  'taxTreatment',
  'waiverDocumentId',
  'linkOutUrl',
  'affiliateUrl',
  'adultPrice',
  'childPrice',
] as const satisfies readonly ExperienceFormField[];

type ParseOptions = { creating: boolean };

/**
 * One form for both create and edit. The fields a choice makes irrelevant are dropped, not
 * refused, because a browser without script cannot hide them: age limits belong to the age rule
 * that uses them, the weather hours to the "decided before start" policy, and the waiver document
 * to a waiver that is required. The rules that tie the rest together are the catalog's own.
 */
function parseFields(
  get: FormGetter,
  options: ParseOptions,
): ExperienceFormResult<{ content: ExperienceContent; hostId: string | null }> {
  const oversized = oversizedFields(
    get,
    experienceFormFields,
    experienceLimits.rawField,
  );
  if (oversized.length > 0) return { ok: false, fields: oversized };

  const parsed = FieldsSchema.safeParse(
    Object.fromEntries(
      textFields.map((field) => [field, formText(get, field)]),
    ),
  );
  const failed = new Set<ExperienceFormField>();
  if (!parsed.success) {
    for (const field of fieldsFromIssues(
      parsed.error.issues,
      experienceFormFields,
    )) {
      failed.add(field);
    }
    if (options.creating && formText(get, 'hostId') === undefined) {
      failed.add('hostId');
    }
    return { ok: false, fields: inFieldOrder(experienceFormFields, failed) };
  }
  const { data } = parsed;
  const slug = slugFor(
    data.name,
    data.slug,
    options.creating,
    experienceLimits.slug,
  );
  if (slug === null) failed.add('slug');
  if (options.creating && data.hostId === undefined) failed.add('hostId');

  const waiverRequired = formHas(get, 'waiverRequired');
  if (waiverRequired && data.waiverDocumentId === undefined) {
    failed.add('waiverDocumentId');
  }
  if (data.childPrice !== undefined && data.adultPrice === undefined) {
    failed.add('childPrice');
  }

  const ageRule = data.ageRule;
  const usesMin = ageRule === 'minimum_age' || ageRule === 'age_range';
  const content: ExperienceContent = {
    name: data.name,
    slug: slug ?? '',
    description: data.description ?? null,
    meetingPoint: data.meetingPoint ?? null,
    included: data.included ?? null,
    accessibilityNotes: data.accessibilityNotes ?? null,
    durationMinutes: data.durationMinutes ?? null,
    categoryId: data.categoryId,
    neighborhoodId: data.neighborhoodId,
    cancellationTierId: data.cancellationTierId,
    outdoor: formHas(get, 'outdoor'),
    weatherPolicy: data.weatherPolicy ?? null,
    weatherDecisionHours:
      data.weatherPolicy === 'decided_before_start'
        ? (data.weatherDecisionHours ?? null)
        : null,
    ageRule,
    minAge: usesMin ? (data.minAge ?? null) : null,
    maxAge: ageRule === 'age_range' ? (data.maxAge ?? null) : null,
    taxTreatment: data.taxTreatment,
    waiverRequired,
    waiverDocumentId: waiverRequired ? (data.waiverDocumentId ?? null) : null,
    linkOutUrl: data.linkOutUrl ?? null,
    affiliateUrl: data.affiliateUrl ?? null,
    adultPriceMinor: data.adultPrice ?? null,
    childPriceMinor: data.childPrice ?? null,
    childUsesSpace: formHas(get, 'childUsesSpace'),
  };
  // A guide-only entry's link is checked again where the status is known (`experienceRuleFailures`).
  for (const field of experienceRuleFailures(content, 'draft'))
    failed.add(field);
  if (failed.size > 0) {
    return { ok: false, fields: inFieldOrder(experienceFormFields, failed) };
  }
  return { ok: true, value: { content, hostId: data.hostId ?? null } };
}

/** The create form: it names the host the experience belongs to, and a blank slug comes from the name. */
export function parseExperienceCreateForm(
  get: FormGetter,
): ExperienceFormResult<ExperienceCreateInput> {
  const fields = parseFields(get, { creating: true });
  if (!fields.ok) return fields;
  const { content, hostId } = fields.value;
  return { ok: true, value: { ...content, hostId: hostId ?? '' } };
}

/** The edit form: the slug is shown filled in, so a blank one is an error and never a silent rename. */
export function parseExperienceEditForm(
  get: FormGetter,
): ExperienceFormResult<ExperienceContent> {
  const fields = parseFields(get, { creating: false });
  if (!fields.ok) return fields;
  return { ok: true, value: fields.value.content };
}

/** The form fields the catalog's rules fault for this status. The form is read before the status is known, so the save checks again. */
export function experienceRuleFailures(
  content: ExperienceContent,
  status: ExperienceStatus,
): ExperienceFormField[] {
  const issues = experienceRuleIssues({ ...content, status });
  return fieldsFromIssues(
    issues.map(({ path }) => ({ path: [path] })),
    experienceFormFields,
  );
}

const contentFields = [
  'name',
  'slug',
  'description',
  'meetingPoint',
  'included',
  'accessibilityNotes',
  'durationMinutes',
  'categoryId',
  'neighborhoodId',
  'cancellationTierId',
  'outdoor',
  'weatherPolicy',
  'weatherDecisionHours',
  'ageRule',
  'minAge',
  'maxAge',
  'taxTreatment',
  'waiverRequired',
  'waiverDocumentId',
  'linkOutUrl',
  'affiliateUrl',
  'adultPriceMinor',
  'childPriceMinor',
  'childUsesSpace',
] as const satisfies readonly ExperienceContentField[];

/** Which fields differ, in form order. Nothing differing means nothing is written. */
export function changedExperienceFields(
  before: ExperienceContent,
  after: ExperienceContent,
): ExperienceContentField[] {
  return changedFields(contentFields, before, after);
}

type PriceOptionFields = {
  kind: string;
  priceMinor: number;
  usesSpace: boolean;
};

/** The saved experience as the editor's content, for the form's values and for the comparison before a save. */
export function experienceContentOf(
  row: Omit<
    ExperienceContent,
    'adultPriceMinor' | 'childPriceMinor' | 'childUsesSpace'
  >,
  priceOptions: readonly PriceOptionFields[],
): ExperienceContent {
  const adult = priceOptions.find((option) => option.kind === 'adult');
  const child = priceOptions.find((option) => option.kind === 'child');
  return {
    name: row.name,
    slug: row.slug,
    description: row.description,
    meetingPoint: row.meetingPoint,
    included: row.included,
    accessibilityNotes: row.accessibilityNotes,
    durationMinutes: row.durationMinutes,
    categoryId: row.categoryId,
    neighborhoodId: row.neighborhoodId,
    cancellationTierId: row.cancellationTierId,
    outdoor: row.outdoor,
    weatherPolicy: row.weatherPolicy,
    weatherDecisionHours: row.weatherDecisionHours,
    ageRule: row.ageRule,
    minAge: row.minAge,
    maxAge: row.maxAge,
    taxTreatment: row.taxTreatment,
    waiverRequired: row.waiverRequired,
    waiverDocumentId: row.waiverDocumentId,
    linkOutUrl: row.linkOutUrl,
    affiliateUrl: row.affiliateUrl,
    adultPriceMinor: adult?.priceMinor ?? null,
    childPriceMinor: child?.priceMinor ?? null,
    // A child with no option yet starts as taking a space, the common case.
    childUsesSpace: child?.usesSpace ?? true,
  };
}

/** What the create form starts with: a blank experience that takes the shared defaults. */
export function newExperienceValues(
  defaults: Pick<
    ExperienceContent,
    'categoryId' | 'neighborhoodId' | 'cancellationTierId'
  >,
): ExperienceContent {
  return {
    ...defaults,
    name: '',
    slug: '',
    description: null,
    meetingPoint: null,
    included: null,
    accessibilityNotes: null,
    durationMinutes: null,
    outdoor: false,
    weatherPolicy: null,
    weatherDecisionHours: null,
    ageRule: 'all_ages',
    minAge: null,
    maxAge: null,
    taxTreatment: 'unknown',
    waiverRequired: false,
    waiverDocumentId: null,
    linkOutUrl: null,
    affiliateUrl: null,
    adultPriceMinor: null,
    childPriceMinor: null,
    childUsesSpace: true,
  };
}

type PriceKind = 'adult' | 'child';

/** The price options the content asks for. An adult option always takes a space; a child's is the form's choice. */
export function desiredPriceOptions(
  content: ExperienceContent,
): { kind: PriceKind; priceMinor: number; usesSpace: boolean }[] {
  const options: { kind: PriceKind; priceMinor: number; usesSpace: boolean }[] =
    [];
  if (content.adultPriceMinor !== null) {
    options.push({
      kind: 'adult',
      priceMinor: content.adultPriceMinor,
      usesSpace: true,
    });
  }
  if (content.childPriceMinor !== null) {
    options.push({
      kind: 'child',
      priceMinor: content.childPriceMinor,
      usesSpace: content.childUsesSpace,
    });
  }
  return options;
}

/** A saved price can be changed but not removed: holds and orders point at the option. These are the form fields that tried. */
export function removedPriceFields(
  before: ExperienceContent,
  after: ExperienceContent,
): ('adultPrice' | 'childPrice')[] {
  const removed: ('adultPrice' | 'childPrice')[] = [];
  if (before.adultPriceMinor !== null && after.adultPriceMinor === null) {
    removed.push('adultPrice');
  }
  if (before.childPriceMinor !== null && after.childPriceMinor === null) {
    removed.push('childPrice');
  }
  return removed;
}

const priceFields = [
  'adultPriceMinor',
  'childPriceMinor',
  'childUsesSpace',
] as const satisfies readonly ExperienceContentField[];

export type ExperienceColumns = Omit<
  ExperienceContent,
  (typeof priceFields)[number]
>;

/** The columns of the experience row the content sets: everything but the price options. */
export function experienceColumnsOf(
  content: ExperienceContent,
): ExperienceColumns {
  const kept = Object.entries(content).filter(
    ([field]) => !(priceFields as readonly string[]).includes(field),
  );
  return Object.fromEntries(kept) as ExperienceColumns;
}

/** A guide-only entry links out, so its link is required. */
export function linksOut(status: ExperienceStatus): boolean {
  return status === 'guide_only';
}

export type PlaceSlugs = { categorySlug: string; neighborhoodSlug: string };

/**
 * The cache changes of an edit to a listing guests see: one for where it was and one for where it
 * is now, so a move invalidates both places. An edit that stays in one place is one change.
 */
export function listingChanges(
  experienceId: string,
  before: PlaceSlugs,
  after: PlaceSlugs,
): CacheChange[] {
  const places =
    before.categorySlug === after.categorySlug &&
    before.neighborhoodSlug === after.neighborhoodSlug
      ? [after]
      : [before, after];
  return places.map((place) => ({
    kind: 'listing',
    id: experienceId,
    categorySlugs: [place.categorySlug],
    neighborhoodSlug: place.neighborhoodSlug,
  }));
}

/** One saved experience as the editor shows it. */
export type ExperienceEditView = {
  id: string;
  hostId: string;
  hostName: string;
  status: ExperienceStatus;
  content: ExperienceContent;
  /** The gallery in order; the first is the cover. */
  photos: readonly GuestPhoto[];
};

export function buildExperienceEditView(
  experience: HostExperience,
  hostName: string,
  photos: readonly GuestPhoto[],
): ExperienceEditView {
  return {
    id: experience.id,
    hostId: experience.hostId,
    hostName,
    status: experience.status,
    content: experienceContentOf(experience, experience.priceOptions),
    photos,
  };
}

export type ExperienceListRow = {
  id: string;
  name: string;
  status: ExperienceStatus;
  hostName: string;
  categoryName: string;
};

export type ExperienceFilters = {
  status: ExperienceStatus | null;
  hostId: string | null;
  categoryId: string | null;
};

/** The choices a form offers, labelled. The cancellation tiers are shared reference data, read and never edited. */
export type ExperienceChoices = {
  hosts: SelectOption[];
  categories: SelectOption[];
  neighborhoods: SelectOption[];
  cancellationTiers: SelectOption[];
  /** The tier a new experience starts on; empty when the reference data holds none. */
  defaultCancellationTierId: string;
  waivers: SelectOption[];
};

type WaiverVersion = { id: string; title: string; version: number };

export function buildExperienceChoices(input: {
  hosts: readonly { id: string; name: string }[];
  categories: readonly Category[];
  neighborhoods: readonly Neighborhood[];
  cancellationTiers: readonly CancellationTier[];
  waivers: readonly WaiverVersion[];
}): ExperienceChoices {
  return {
    hosts: input.hosts.map(({ id, name }) => ({ value: id, label: name })),
    categories: input.categories.map(({ id, name }) => ({
      value: id,
      label: name,
    })),
    neighborhoods: input.neighborhoods.map(({ id, name }) => ({
      value: id,
      label: name,
    })),
    cancellationTiers: input.cancellationTiers.map((tier) => ({
      value: tier.id,
      label: `${tier.name}: ${cancellationTerms(tier).fact}`,
    })),
    defaultCancellationTierId:
      input.cancellationTiers.find((tier) => tier.isDefault)?.id ?? '',
    waivers: input.waivers.map(({ id, title, version }) => ({
      value: id,
      label: `${title} (version ${String(version)})`,
    })),
  };
}

/** The filters the address names. A host or category the page does not offer, or a repeated name, reads as no filter. */
export function parseExperienceFilters(
  query: TableQuery,
  offered: Pick<ExperienceChoices, 'hosts' | 'categories'>,
): ExperienceFilters {
  return {
    status: parseStatusParam(
      query.status,
      experienceStatuses,
      experienceStatusOptions,
    ),
    hostId: pickKnown(
      parseSingle(query.host, z.string()),
      offered.hosts.map((host) => host.value),
      null,
    ),
    categoryId: pickKnown(
      parseSingle(query.category, z.string()),
      offered.categories.map((category) => category.value),
      null,
    ),
  };
}

export const experienceFieldProblems = {
  hostId: 'Choose the host this experience belongs to.',
  name: 'Enter the experience name, up to 120 characters.',
  slug: 'Use lower-case words joined by hyphens, up to 80 characters. The old address keeps working.',
  description: 'Keep the description under 5000 characters, or leave it empty.',
  meetingPoint: 'Keep the meeting point under 500 characters.',
  included: 'Keep this under 1000 characters.',
  accessibilityNotes: 'Keep this under 1000 characters.',
  durationMinutes: 'Enter whole minutes, from 1 to 1440.',
  categoryId: 'Choose a category.',
  neighborhoodId: 'Choose a neighborhood.',
  cancellationTierId: 'Choose a cancellation tier.',
  outdoor: 'An outdoor experience states a weather policy.',
  weatherPolicy: 'An outdoor experience states a weather policy.',
  weatherDecisionHours: 'Enter whole hours, from 1 to 168.',
  ageRule: 'Choose an age rule.',
  minAge: 'Enter whole years, from 0 to 120, for this age rule.',
  maxAge: 'Enter whole years, from the minimum age to 120.',
  taxTreatment: 'Choose a tax treatment.',
  waiverRequired: 'Choose the waiver guests accept.',
  waiverDocumentId: 'Choose the published waiver guests accept.',
  linkOutUrl: 'Enter a web address starting with http:// or https://.',
  affiliateUrl: 'Enter a web address starting with http:// or https://.',
  adultPrice: 'Enter a price such as 85 or 12.50, up to 99999.99.',
  childPrice:
    'Enter a price such as 40 or 12.50, up to 99999.99, and set the adult price first.',
  childUsesSpace: 'Choose whether a child takes a space.',
} as const satisfies Record<ExperienceFormField, string>;

export const experienceNoticeCodes = [
  'created',
  'updated',
  'unchanged',
  'invalid',
  'reference_missing',
] as const;
export type ExperienceNoticeCode = (typeof experienceNoticeCodes)[number];

export const experienceNotices = {
  created: {
    tone: 'success',
    title: 'Experience created as a draft.',
  },
  updated: { tone: 'success', title: 'Experience saved.' },
  unchanged: {
    tone: 'info',
    title: 'Nothing was different, so nothing was saved.',
  },
  invalid: { tone: 'danger', title: 'Some details need another look.' },
  reference_missing: {
    tone: 'danger',
    title:
      'A host, category, neighborhood, tier or waiver on the form is no longer there. Reload the form and try again.',
  },
} as const satisfies Record<ExperienceNoticeCode, NoticeText>;

export const ageRuleLabels = {
  all_ages: 'All ages',
  minimum_age: 'Minimum age',
  age_range: 'Age range',
  twenty_one_plus: '21 and over',
} as const satisfies Record<(typeof ageRules)[number], string>;

export const weatherPolicyLabels = {
  rain_or_shine: 'Runs rain or shine',
  decided_before_start: 'Decided before the start',
} as const satisfies Record<(typeof weatherPolicies)[number], string>;

export const taxTreatmentLabels = {
  taxable: 'Taxable',
  not_taxable: 'Not taxable',
  unknown: 'Unknown (treated as not taxable)',
} as const satisfies Record<(typeof taxTreatments)[number], string>;

/** A select's options from a label map, in the map's order. */
export function labelledOptions(
  labels: Readonly<Record<string, string>>,
): SelectOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

/** A whole number as a form field shows it, empty for none. */
export function numberInputValue(value: number | null): string {
  return value === null ? '' : String(value);
}
