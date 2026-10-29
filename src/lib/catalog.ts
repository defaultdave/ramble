import { z } from 'zod';

export const experienceStatuses = [
  'draft',
  'in_review',
  'live',
  'paused',
  'guide_only',
] as const;

/** The statuses a guest can see. A paused experience, which also covers a discontinued one, is hidden. */
export const guestVisibleStatuses = ['live', 'guide_only'] as const;

/** The most rows a list read of the shared catalog returns, so a read cannot grow with it. */
export const catalogLimits = {
  categories: 100,
  neighborhoods: 100,
} as const;

export const ageRules = [
  'all_ages',
  'minimum_age',
  'age_range',
  'twenty_one_plus',
] as const;

export const weatherPolicies = [
  'rain_or_shine',
  'decided_before_start',
] as const;

export const taxTreatments = ['taxable', 'not_taxable', 'unknown'] as const;

export const priceKinds = ['adult', 'child'] as const;

export const slugEntityKinds = [
  'category',
  'neighborhood',
  'experience',
  'host',
] as const;

// A guid, not a strict RFC uuid: the column accepts any uuid, and a seeded id outside the RFC variants must still read.
export const EntityIdSchema = z.guid();

/**
 * An ID in a write. `z.guid()` accepts upper case and Postgres returns lower case, so an ID
 * written in capitals is lower-cased here: compared against what the database found, it is the
 * same ID, not a missing one.
 */
export const WriteIdSchema = EntityIdSchema.transform((id) => id.toLowerCase());

/**
 * Lower-case words joined by single hyphens. The database CHECK on every slug column spells the
 * pattern `^[a-z0-9]+(-[a-z0-9]+)*$`; this states it without a repeated group, because V8 matches
 * a repeated group by recursion and a slug of a few million characters overflows the stack.
 */
export function isSlug(value: string): boolean {
  return (
    /^[a-z0-9-]+$/.test(value) &&
    !value.startsWith('-') &&
    !value.endsWith('-') &&
    !value.includes('--')
  );
}

export const SlugSchema = z.string().refine(isSlug, {
  message: 'Lower-case words joined by single hyphens',
});

/**
 * The one rule for a stored link, used by the read schemas and by the database CHECKs on
 * `link_out_url` and `affiliate_url` (a migration holds this exact text). An ASCII host whose last
 * label starts with a letter, no `xn--` label, no credentials, a port up to 65535, and a path of
 * printable ASCII. It avoids `new URL()` on purpose: that parse throws on some hosts a looser
 * pattern lets through. An internationalised link is not stored, and a path escapes non-ASCII.
 * It is written to mean the same in JavaScript and in Postgres, case-sensitively.
 */
export const httpUrlPattern = String.raw`^[Hh][Tt][Tt][Pp][Ss]?://((?![Xx][Nn]--)[A-Za-z0-9-]+\.)*(?![Xx][Nn]--)[A-Za-z][A-Za-z0-9-]*(:(6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[0-9]{1,4}))?([/?#][!-~]*)?$`;

const HttpUrlSchema = z.string().regex(new RegExp(httpUrlPattern));

const MinorUnitsSchema = z.int().nonnegative();

export const CategorySchema = z.object({
  id: EntityIdSchema,
  slug: SlugSchema,
  name: z.string().min(1),
});
export type Category = z.infer<typeof CategorySchema>;

export const NeighborhoodSchema = z.object({
  id: EntityIdSchema,
  slug: SlugSchema,
  name: z.string().min(1),
});
export type Neighborhood = z.infer<typeof NeighborhoodSchema>;

export const CancellationTierSchema = z.object({
  id: EntityIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  fullRefundHoursBefore: z.int().nonnegative(),
  isDefault: z.boolean(),
});
export type CancellationTier = z.infer<typeof CancellationTierSchema>;

export const RetiredSlugSchema = z.object({
  entityKind: z.enum(slugEntityKinds),
  entityId: EntityIdSchema,
  slug: SlugSchema,
  retiredAt: z.date(),
});
export type RetiredSlug = z.infer<typeof RetiredSlugSchema>;

export const PriceOptionSchema = z.object({
  id: EntityIdSchema,
  experienceId: EntityIdSchema,
  kind: z.enum(priceKinds),
  priceMinor: MinorUnitsSchema,
  usesSpace: z.boolean(),
});
export type PriceOption = z.infer<typeof PriceOptionSchema>;

/** The part of a host a guest page shows. Time zone and creation time stay on the server. */
const GuestHostSchema = z.object({
  id: EntityIdSchema,
  slug: SlugSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
});

const experienceFields = z.object({
  id: EntityIdSchema,
  hostId: EntityIdSchema,
  categoryId: EntityIdSchema,
  neighborhoodId: EntityIdSchema,
  cancellationTierId: EntityIdSchema,
  slug: SlugSchema,
  name: z.string().min(1),
  description: z.string().nullable(),
  meetingPoint: z.string().nullable(),
  included: z.string().nullable(),
  durationMinutes: z.int().positive().nullable(),
  accessibilityNotes: z.string().nullable(),
  status: z.enum(experienceStatuses),
  outdoor: z.boolean(),
  weatherPolicy: z.enum(weatherPolicies).nullable(),
  weatherDecisionHours: z.int().positive().nullable(),
  ageRule: z.enum(ageRules),
  minAge: z.int().nonnegative().nullable(),
  maxAge: z.int().nonnegative().nullable(),
  taxTreatment: z.enum(taxTreatments),
  waiverRequired: z.boolean(),
  waiverDocumentId: EntityIdSchema.nullable(),
  linkOutUrl: HttpUrlSchema.nullable(),
  affiliateUrl: HttpUrlSchema.nullable(),
  createdAt: z.date(),
});

type RuleFields = Pick<
  z.infer<typeof experienceFields>,
  | 'status'
  | 'outdoor'
  | 'weatherPolicy'
  | 'weatherDecisionHours'
  | 'ageRule'
  | 'minAge'
  | 'maxAge'
  | 'linkOutUrl'
>;

type RuleIssue = { path: keyof RuleFields; message: string };

function ageRuleIssues(value: RuleFields): RuleIssue[] {
  const { ageRule, minAge, maxAge } = value;
  switch (ageRule) {
    case 'all_ages':
    case 'twenty_one_plus':
      return minAge === null && maxAge === null
        ? []
        : [{ path: 'ageRule', message: `${ageRule} takes no age limits` }];
    case 'minimum_age':
      return minAge !== null && maxAge === null
        ? []
        : [
            {
              path: 'minAge',
              message: 'minimum_age needs a minimum age and no maximum',
            },
          ];
    case 'age_range':
      if (minAge === null || maxAge === null) {
        return [
          {
            path: 'minAge',
            message: 'age_range needs a minimum and a maximum',
          },
        ];
      }
      return minAge <= maxAge
        ? []
        : [{ path: 'maxAge', message: 'maxAge must not be below minAge' }];
  }
}

function weatherIssues(value: RuleFields): RuleIssue[] {
  const { outdoor, weatherPolicy, weatherDecisionHours } = value;
  const issues: RuleIssue[] = [];
  if (outdoor && weatherPolicy === null) {
    issues.push({
      path: 'weatherPolicy',
      message: 'An outdoor experience states a weather policy',
    });
  }
  if (
    (weatherPolicy === 'decided_before_start') !==
    (weatherDecisionHours !== null)
  ) {
    issues.push({
      path: 'weatherDecisionHours',
      message:
        'weatherDecisionHours is set exactly when the policy is decided_before_start',
    });
  }
  return issues;
}

function guideOnlyIssues(value: RuleFields): RuleIssue[] {
  return value.status === 'guide_only' && value.linkOutUrl === null
    ? [{ path: 'linkOutUrl', message: 'A guide-only entry links out' }]
    : [];
}

/** Rules that tie fields together. The database CHECKs on `experiences` state the same rules. */
function checkExperienceRules(value: RuleFields, ctx: z.RefinementCtx) {
  for (const issue of [
    ...ageRuleIssues(value),
    ...weatherIssues(value),
    ...guideOnlyIssues(value),
  ]) {
    ctx.addIssue({
      code: 'custom',
      path: [issue.path],
      message: issue.message,
    });
  }
}

/**
 * What a guest page may hold. `taxTreatment`, `waiverDocumentId` and `createdAt` are left out and
 * Zod's strip drops them from any row that carries them. The status is narrowed to the visible ones,
 * so a row that slipped past the database condition fails the parse.
 */
export const GuestExperienceSchema = experienceFields
  .omit({ taxTreatment: true, waiverDocumentId: true, createdAt: true })
  .extend({
    status: z.enum(guestVisibleStatuses),
    host: GuestHostSchema,
    priceOptions: z.array(PriceOptionSchema),
    cancellationTier: CancellationTierSchema,
  })
  .superRefine(checkExperienceRules);
export type GuestExperience = z.infer<typeof GuestExperienceSchema>;

/** Every experience field, for the owning host and for ops. */
export const HostExperienceSchema = experienceFields
  .extend({
    priceOptions: z.array(PriceOptionSchema),
    cancellationTier: CancellationTierSchema,
  })
  .superRefine(checkExperienceRules);
export type HostExperience = z.infer<typeof HostExperienceSchema>;
