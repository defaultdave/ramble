import { z } from 'zod';
import type { AlertTone } from './alertTone';
import type { CacheChange } from './cacheTags';
import { cancellationTerms } from './cancellation';
import {
  ageRules,
  experienceRuleIssues,
  experienceStatuses,
  guestVisibleStatuses,
  HttpUrlSchema,
  slugify,
  SlugSchema,
  taxTreatments,
  weatherPolicies,
  WriteIdSchema,
  type CancellationTier,
  type Category,
  type HostExperience,
  type Neighborhood,
} from './catalog';
import { parseSingle } from './filters';
import { formatMoney } from './money';
import { pickKnown } from './pickKnown';
import { maxSessionMinutes } from './sessions';
import {
  parseStatusFilter,
  type StatusFilterOption,
  type StatusTone,
} from './statusBadge';
import { tableHref, type TableQuery } from './tableQuery';
import { requiredText } from './text';

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
const experienceFormFields = [
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

type FormGetter = (name: string) => unknown;

function textOf(get: FormGetter, name: string): string | undefined {
  const raw = get(name);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

const CENTS_PER_DOLLAR = 100;
const priceText = /^\$?(\d{1,5})(?:\.(\d{1,2}))?$/;

/** A price as typed, "12", "12.5" or "$12.50", in minor units; null when it is not a price in range. Integer arithmetic only. */
export function parsePriceMinor(text: string): number | null {
  const match = priceText.exec(text.trim());
  if (!match) return null;
  const [, dollars = '', cents = ''] = match;
  const minor =
    Number(dollars) * CENTS_PER_DOLLAR + Number(cents.padEnd(2, '0'));
  return minor <= experienceLimits.priceMinor ? minor : null;
}

/** A price as the form shows it for editing: "12.50", with no symbol or grouping. */
export function priceInputValue(minor: number | null): string {
  return minor === null ? '' : formatMoney(minor).replace(/[$,]/g, '');
}

const PriceSchema = z.string().transform((text, ctx) => {
  const minor = parsePriceMinor(text);
  if (minor === null) ctx.addIssue({ code: 'custom', message: 'A price' });
  return minor ?? 0;
});

const IntegerFieldSchema = (max: number, min = 0) =>
  z
    .string()
    .regex(/^\d{1,6}$/)
    .transform(Number)
    .pipe(z.int().min(min).max(max));

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
  durationMinutes: IntegerFieldSchema(maxSessionMinutes, 1).optional(),
  categoryId: WriteIdSchema,
  neighborhoodId: WriteIdSchema,
  cancellationTierId: WriteIdSchema,
  weatherPolicy: z.enum(weatherPolicies).optional(),
  weatherDecisionHours: IntegerFieldSchema(
    experienceLimits.weatherDecisionHours,
    1,
  ).optional(),
  ageRule: z.enum(ageRules),
  minAge: IntegerFieldSchema(experienceLimits.maxAge).optional(),
  maxAge: IntegerFieldSchema(experienceLimits.maxAge).optional(),
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

function inFormOrder(failed: ReadonlySet<ExperienceFormField>) {
  return experienceFormFields.filter((field) => failed.has(field));
}

/** A slug is typed or comes from the name, never repaired after the fact: a name that leaves none, or one too long, is refused. */
function slugFor(
  name: string,
  typed: string | undefined,
  derive: boolean,
): string | null {
  const slug = typed ?? (derive ? slugify(name) : '');
  return slug !== '' && slug.length <= experienceLimits.slug ? slug : null;
}

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
  const oversized = experienceFormFields.filter((field) => {
    const raw = get(field);
    return typeof raw === 'string' && raw.length > experienceLimits.rawField;
  });
  if (oversized.length > 0) return { ok: false, fields: oversized };

  const parsed = FieldsSchema.safeParse(
    Object.fromEntries(textFields.map((field) => [field, textOf(get, field)])),
  );
  const failed = new Set<ExperienceFormField>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = pickKnown(
        String(issue.path[0]),
        experienceFormFields,
        null,
      );
      if (field !== null) failed.add(field);
    }
    if (options.creating && textOf(get, 'hostId') === undefined) {
      failed.add('hostId');
    }
    return { ok: false, fields: inFormOrder(failed) };
  }
  const { data } = parsed;
  const slug = slugFor(data.name, data.slug, options.creating);
  if (slug === null) failed.add('slug');
  if (options.creating && data.hostId === undefined) failed.add('hostId');

  const waiverRequired = has(get, 'waiverRequired');
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
    outdoor: has(get, 'outdoor'),
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
    childUsesSpace: has(get, 'childUsesSpace'),
  };
  // A guide-only entry's link is checked again where the status is known (`experienceRuleFailures`).
  for (const field of experienceRuleFailures(content, 'draft'))
    failed.add(field);
  if (failed.size > 0) return { ok: false, fields: inFormOrder(failed) };
  return { ok: true, value: { content, hostId: data.hostId ?? null } };
}

/** A checkbox is ticked when the form carries it with any value. */
function has(get: FormGetter, name: string): boolean {
  const raw = get(name);
  return raw !== null && raw !== undefined;
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

/** The id a form carries for the experience it edits, or null when it is not an id. */
export function parseExperienceIdField(raw: unknown): string | null {
  const parsed = WriteIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The form fields the catalog's rules fault for this status. The form is read before the status is known, so the save checks again. */
export function experienceRuleFailures(
  content: ExperienceContent,
  status: ExperienceStatus,
): ExperienceFormField[] {
  const failed = new Set<ExperienceFormField>();
  for (const issue of experienceRuleIssues({ ...content, status })) {
    const field = pickKnown(issue.path, experienceFormFields, null);
    if (field !== null) failed.add(field);
  }
  return inFormOrder(failed);
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
  return contentFields.filter((field) => before[field] !== after[field]);
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

/** Whether guests can see an experience in this status, so a change to it reaches cached pages. */
export function isGuestVisible(status: ExperienceStatus): boolean {
  return (guestVisibleStatuses as readonly string[]).includes(status);
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
};

export function buildExperienceEditView(
  experience: HostExperience,
  hostName: string,
): ExperienceEditView {
  return {
    id: experience.id,
    hostId: experience.hostId,
    hostName,
    status: experience.status,
    content: experienceContentOf(experience, experience.priceOptions),
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

export type Choice = { value: string; label: string };

/** The choices a form offers, labelled. The cancellation tiers are shared reference data, read and never edited. */
export type ExperienceChoices = {
  hosts: Choice[];
  categories: Choice[];
  neighborhoods: Choice[];
  cancellationTiers: Choice[];
  /** The tier a new experience starts on; empty when the reference data holds none. */
  defaultCancellationTierId: string;
  waivers: Choice[];
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
  const status = parseStatusFilter(query.status, experienceStatusOptions);
  return {
    status: pickKnown(status, experienceStatuses, null),
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

const noticeCodes = [
  'created',
  'updated',
  'unchanged',
  'invalid',
  'reference_missing',
] as const;
export type ExperienceNoticeCode = (typeof noticeCodes)[number];

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
} as const satisfies Record<
  ExperienceNoticeCode,
  { tone: AlertTone; title: string }
>;

/** The notice an address names, or null for none or an unknown one. */
export function parseExperienceNotice(
  raw: string | readonly string[] | undefined,
): ExperienceNoticeCode | null {
  return typeof raw === 'string' ? pickKnown(raw, noticeCodes, null) : null;
}

/** The fields an address names as needing another look, in form order, and only known ones. */
export function parseProblemFields(
  raw: string | readonly string[] | undefined,
): ExperienceFormField[] {
  const named = typeof raw === 'string' ? raw.split(',') : [];
  return experienceFormFields.filter((field) => named.includes(field));
}

/** Where an action sends the person next: a path, a notice, and for a refused form the fields to look at. */
export function experienceNoticeHref(
  path: string,
  notice: ExperienceNoticeCode,
  fields: readonly ExperienceFormField[] = [],
): string {
  return tableHref(path, { notice, fields: fields.join(',') });
}

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
): Choice[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

/** A whole number as a form field shows it, empty for none. */
export function numberInputValue(value: number | null): string {
  return value === null ? '' : String(value);
}
