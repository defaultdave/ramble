import { z } from 'zod';
import type { CacheChange } from './cacheTags';
import { EntityIdSchema, SlugSchema } from './catalog';
import type { RichTextDoc } from './richText/format';
import { richTextSchema } from './richText/schema';
import { sanitizeRichText } from './richText/sanitize';
import { isStorableJson, optionalText, requiredText } from './text';

export const collectionKinds = ['pick', 'gift_guide'] as const;

export const publishStatuses = ['draft', 'published'] as const;

export const homeModuleKinds = [
  'hero_search',
  'category_rail',
  'picks',
  'gift_guide',
  'this_week',
  'reassurance',
] as const;

/** The kinds that can point at a collection. */
export const homeModuleKindsWithCollection = ['picks', 'gift_guide'] as const;

export const pageCopyKinds = ['category', 'neighborhood'] as const;

/**
 * One place for every size limit, so the Zod schemas and the database CHECKs cannot drift. A
 * migration holds the same numbers, and a test reads them back out of it.
 */
export const editorialLimits = {
  slug: 80,
  title: 120,
  summary: 300,
  note: 280,
  heading: 120,
  metaDescription: 200,
  collectionItems: 60,
  homeModules: 20,
  helpPosition: 9999,
  /** Bytes of a rich-text document as `JSON.stringify` writes it. */
  richTextBytes: 100_000,
  /** What Postgres stores a document as when it renders it back to text. jsonb adds a space after every colon and comma, so this is the looser backstop. */
  richTextStoredBytes: 200_000,
  /** The most rows any list read returns. */
  listed: 200,
} as const;

const textEncoder = new TextEncoder();

function byteLength(doc: RichTextDoc): number {
  return textEncoder.encode(JSON.stringify(doc)).length;
}

/**
 * The write boundary for a stored document (SEC-6): the format check of `richTextSchema`, then
 * the size limit the database CHECK backs, then a refusal of the characters Postgres cannot store.
 */
export const RichTextInputSchema = richTextSchema
  .refine((doc) => byteLength(doc) <= editorialLimits.richTextBytes, {
    message: `A document is at most ${String(editorialLimits.richTextBytes)} bytes`,
  })
  .refine(isStorableJson, {
    message: 'A document holds a character that cannot be stored',
  });

/**
 * The read side repairs instead of refusing, as the renderer does: one bad stored document must
 * not take a page down, and every write has already passed `RichTextInputSchema`.
 */
export const RichTextStoredSchema = z
  .unknown()
  .transform((value) => sanitizeRichText(value));

const SlugFieldSchema = SlugSchema.max(editorialLimits.slug);

const timestamps = {
  publishedAt: z.date().nullable(),
  updatedAt: z.date(),
};

// ---- Collections: Ramble Picks and the gift guide ----

const CollectionItemSchema = z.object({
  experienceId: EntityIdSchema,
  note: optionalText(editorialLimits.note),
});
export type CollectionItem = z.infer<typeof CollectionItemSchema>;

const collectionFields = {
  id: EntityIdSchema,
  kind: z.enum(collectionKinds),
  slug: SlugFieldSchema,
  title: requiredText(editorialLimits.title),
  summary: optionalText(editorialLimits.summary),
  status: z.enum(publishStatuses),
};

export const CollectionSchema = z.object({
  ...collectionFields,
  intro: RichTextStoredSchema.nullable(),
  ...timestamps,
  items: z.array(CollectionItemSchema),
});
export type Collection = z.infer<typeof CollectionSchema>;

const uniqueExperienceIds = (items: readonly CollectionItem[]) =>
  new Set(items.map((item) => item.experienceId)).size === items.length;

/** `id` is set to edit a collection and left out to create one. The kind of an existing collection never changes. */
export const CollectionInputSchema = z.strictObject({
  id: collectionFields.id.optional(),
  kind: collectionFields.kind,
  slug: collectionFields.slug,
  title: collectionFields.title,
  summary: collectionFields.summary,
  intro: RichTextInputSchema.nullable(),
  status: collectionFields.status,
  items: z
    .array(CollectionItemSchema)
    .max(editorialLimits.collectionItems)
    .refine(uniqueExperienceIds, {
      message: 'An experience appears once in a collection',
    }),
});
export type CollectionInput = z.infer<typeof CollectionInputSchema>;

// ---- Home modules ----

const homeModuleFields = {
  kind: z.enum(homeModuleKinds),
  enabled: z.boolean(),
  heading: optionalText(editorialLimits.heading),
  collectionId: EntityIdSchema.nullable(),
};

type CollectionTarget = {
  kind: (typeof homeModuleKinds)[number];
  collectionId: string | null;
};

/** A module points at a collection only when its kind shows one. The database CHECK says the same. */
function collectionNotAllowed(module: CollectionTarget): boolean {
  return (
    module.collectionId !== null &&
    !(homeModuleKindsWithCollection as readonly string[]).includes(module.kind)
  );
}

/**
 * A picks module shows a Pick and a gift_guide module shows the gift guide. The database holds
 * the same rule as a composite foreign key from `home_modules` to `collections (id, kind)`.
 */
export function hasCollectionKindMismatch(
  modules: readonly CollectionTarget[],
  collectionKindById: ReadonlyMap<string, (typeof collectionKinds)[number]>,
): boolean {
  return modules.some(({ kind, collectionId }) => {
    if (collectionId === null) return false;
    const shown = kind === 'picks' ? 'pick' : 'gift_guide';
    return collectionKindById.get(collectionId) !== shown;
  });
}

const collectionOnlyForCollectionKinds = {
  message: 'Only a picks or gift_guide module points at a collection',
  path: ['collectionId'],
};

export const HomeModuleSchema = z
  .object({
    id: EntityIdSchema,
    position: z.int().nonnegative(),
    ...homeModuleFields,
    body: RichTextStoredSchema.nullable(),
  })
  .refine(
    (module) => !collectionNotAllowed(module),
    collectionOnlyForCollectionKinds,
  );
export type HomeModule = z.infer<typeof HomeModuleSchema>;

const HomeModuleInputSchema = z
  .strictObject({
    ...homeModuleFields,
    body: RichTextInputSchema.nullable(),
  })
  .refine(
    (module) => !collectionNotAllowed(module),
    collectionOnlyForCollectionKinds,
  );

/** The whole ordered list, as saved: position is the index. */
export const HomeModulesInputSchema = z
  .array(HomeModuleInputSchema)
  .max(editorialLimits.homeModules);
export type HomeModulesInput = z.infer<typeof HomeModulesInputSchema>;

// ---- Page copy: category and neighborhood pages ----

const pageCopyFields = {
  heading: optionalText(editorialLimits.heading),
  metaDescription: optionalText(editorialLimits.metaDescription),
  status: z.enum(publishStatuses),
};

export const PageCopySchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(pageCopyKinds),
  /** The slug of the category or neighborhood the copy belongs to, whose column this unit does not own. */
  slug: SlugSchema,
  ...pageCopyFields,
  intro: RichTextStoredSchema.nullable(),
  body: RichTextStoredSchema.nullable(),
  ...timestamps,
});
export type PageCopy = z.infer<typeof PageCopySchema>;

/** Copy for a category or neighborhood that has none yet is created; one that has some is replaced. */
export const PageCopyInputSchema = z.strictObject({
  kind: z.enum(pageCopyKinds),
  targetId: EntityIdSchema,
  ...pageCopyFields,
  intro: RichTextInputSchema.nullable(),
  body: RichTextInputSchema.nullable(),
});
export type PageCopyInput = z.infer<typeof PageCopyInputSchema>;

// ---- Help articles ----

const helpArticleFields = {
  slug: SlugFieldSchema,
  title: requiredText(editorialLimits.title),
  summary: optionalText(editorialLimits.summary),
  position: z.int().min(0).max(editorialLimits.helpPosition),
  status: z.enum(publishStatuses),
};

export const HelpArticleSchema = z.object({
  id: EntityIdSchema,
  ...helpArticleFields,
  body: RichTextStoredSchema,
  ...timestamps,
});
export type HelpArticle = z.infer<typeof HelpArticleSchema>;

/** What a help index lists: no body. */
export const HelpArticleSummarySchema = HelpArticleSchema.pick({
  id: true,
  slug: true,
  title: true,
  summary: true,
});
export type HelpArticleSummary = z.infer<typeof HelpArticleSummarySchema>;

export const HelpArticleInputSchema = z.strictObject({
  id: EntityIdSchema.optional(),
  ...helpArticleFields,
  body: RichTextInputSchema,
});
export type HelpArticleInput = z.infer<typeof HelpArticleInputSchema>;

// ---- Publishing ----

/** The change a guest page can see: nothing for a draft. */
export function visibleChange(
  status: (typeof publishStatuses)[number],
  change: CacheChange,
): CacheChange | null {
  return status === 'published' ? change : null;
}

/**
 * The tags a save invalidates: what guests could see before it and what they can see after. A
 * draft edited while still a draft changes nothing a guest sees, and a rename or an unpublish
 * has to reach the old address as well as the new one.
 */
export function changesWhenSaved(
  before: CacheChange | null | undefined,
  after: CacheChange | null,
): CacheChange[] {
  return [before, after].filter(
    (change): change is CacheChange => change !== null && change !== undefined,
  );
}

export function collectionChange(
  kind: (typeof collectionKinds)[number],
  slug: string,
): CacheChange {
  return kind === 'gift_guide' ? { kind: 'giftGuide' } : { kind: 'pick', slug };
}

export function pageCopyChange(
  kind: (typeof pageCopyKinds)[number],
  slug: string,
): CacheChange {
  return kind === 'category'
    ? { kind: 'categoryCopy', slug }
    : { kind: 'neighborhoodCopy', slug };
}

type PublishStatus = (typeof publishStatuses)[number];

/**
 * When a save stamps the publication time. A row publishes at the moment its status becomes
 * `published`, keeps its first time while it stays published, and has none as a draft.
 */
export function publishedAtAfter(
  before: { status: PublishStatus; publishedAt: Date | null } | undefined,
  status: PublishStatus,
): 'now' | Date | null {
  if (status === 'draft') return null;
  return before?.status === 'published' && before.publishedAt
    ? before.publishedAt
    : 'now';
}

/** Puts each collection's items under it, in the order the items arrive. */
export function withItems<R extends { id: string }>(
  rows: readonly R[],
  items: readonly (CollectionItem & { collectionId: string })[],
): (R & { items: CollectionItem[] })[] {
  const byCollection = new Map<string, CollectionItem[]>();
  for (const { collectionId, experienceId, note } of items) {
    const list = byCollection.get(collectionId) ?? [];
    list.push({ experienceId, note });
    byCollection.set(collectionId, list);
  }
  return rows.map((row) => ({ ...row, items: byCollection.get(row.id) ?? [] }));
}
