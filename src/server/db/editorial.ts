import 'server-only';
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { CacheChange } from '@/lib/cacheTags';
import { SlugSchema } from '@/lib/catalog';
import {
  CollectionInputSchema,
  CollectionSchema,
  HelpArticleInputSchema,
  HelpArticleSchema,
  HelpArticleSummarySchema,
  HomeModuleSchema,
  HomeModulesInputSchema,
  PageCopyInputSchema,
  PageCopySchema,
  changesWhenSaved,
  collectionChange,
  editorialLimits,
  pageCopyChange,
  publishedAtAfter,
  visibleChange,
  withItems,
  type Collection,
  type CollectionInput,
  type HelpArticle,
  type HelpArticleInput,
  type HelpArticleSummary,
  type HomeModule,
  type HomeModulesInput,
  type PageCopy,
  type PageCopyInput,
} from '@/lib/editorial';
import type { Caller } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { guestVisible } from './catalog';
import { db, dbRead } from './client';
import {
  categories,
  collectionItems,
  collections,
  experiences,
  helpArticles,
  homeModules,
  neighborhoods,
  pages,
} from './schema';
import { requireStaff } from './staff';

type PageCopyKind = PageCopy['kind'];

// ---- Guest reads: published content only ----

async function readCollections(
  where: SQL | undefined,
  forGuest: boolean,
): Promise<Collection[]> {
  const rows = await dbRead
    .select()
    .from(collections)
    .where(where)
    .orderBy(asc(collections.title), asc(collections.id))
    .limit(editorialLimits.listed);
  if (rows.length === 0) return [];
  const items = await dbRead
    .select({
      collectionId: collectionItems.collectionId,
      experienceId: collectionItems.experienceId,
      note: collectionItems.note,
    })
    .from(collectionItems)
    .innerJoin(experiences, eq(collectionItems.experienceId, experiences.id))
    .where(
      and(
        inArray(
          collectionItems.collectionId,
          rows.map((row) => row.id),
        ),
        forGuest ? guestVisible : undefined,
      ),
    )
    .orderBy(asc(collectionItems.collectionId), asc(collectionItems.position));
  return CollectionSchema.array().parse(withItems(rows, items));
}

const publishedCollection = eq(collections.status, 'published');

// TODO(U-030): first caller
/** The published Ramble Picks, with the entries a guest can see. */
export function listPublishedPicks(): Promise<Collection[]> {
  return readCollections(
    and(publishedCollection, eq(collections.kind, 'pick')),
    true,
  );
}

// TODO(U-030): first caller
/** Null when the slug is malformed, the Pick is missing, or it is still a draft. */
export async function getPublishedPick(
  slug: string,
): Promise<Collection | null> {
  const parsed = SlugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const [pick] = await readCollections(
    and(
      publishedCollection,
      eq(collections.kind, 'pick'),
      eq(collections.slug, parsed.data),
    ),
    true,
  );
  return pick ?? null;
}

// TODO(U-030): first caller
export async function getPublishedGiftGuide(): Promise<Collection | null> {
  const [guide] = await readCollections(
    and(publishedCollection, eq(collections.kind, 'gift_guide')),
    true,
  );
  return guide ?? null;
}

// TODO(U-030): first caller
/**
 * The enabled modules in order. A module that points at a collection still in draft is left out,
 * so the home page never shows an unpublished one.
 */
export async function listHomeModules(): Promise<HomeModule[]> {
  const rows = await dbRead
    .select({ module: homeModules })
    .from(homeModules)
    .leftJoin(collections, eq(homeModules.collectionId, collections.id))
    .where(
      and(
        eq(homeModules.enabled, true),
        sql`${homeModules.collectionId} IS NULL OR ${collections.status} = 'published'`,
      ),
    )
    .orderBy(asc(homeModules.position));
  return HomeModuleSchema.array().parse(rows.map(({ module }) => module));
}

async function readPageCopy(
  kind: PageCopyKind,
  slug: string,
  onlyPublished: boolean,
): Promise<PageCopy[]> {
  const target = kind === 'category' ? categories : neighborhoods;
  const link = kind === 'category' ? pages.categoryId : pages.neighborhoodId;
  const rows = await dbRead
    .select({ page: pages, slug: target.slug })
    .from(pages)
    .innerJoin(target, eq(link, target.id))
    .where(
      and(
        eq(target.slug, slug),
        onlyPublished ? eq(pages.status, 'published') : undefined,
      ),
    );
  return PageCopySchema.array().parse(
    rows.map(({ page, slug: targetSlug }) => ({
      ...page,
      kind,
      slug: targetSlug,
    })),
  );
}

// TODO(U-035): first caller
/** Null when the slug is malformed, has no copy, or the copy is still a draft. */
export async function getPublishedPageCopy(
  kind: PageCopyKind,
  slug: string,
): Promise<PageCopy | null> {
  const parsed = SlugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const [copy] = await readPageCopy(kind, parsed.data, true);
  return copy ?? null;
}

// TODO(U-038): first caller
export async function listPublishedHelpArticles(): Promise<
  HelpArticleSummary[]
> {
  const rows = await dbRead
    .select()
    .from(helpArticles)
    .where(eq(helpArticles.status, 'published'))
    .orderBy(
      asc(helpArticles.position),
      asc(helpArticles.title),
      asc(helpArticles.id),
    )
    .limit(editorialLimits.listed);
  return HelpArticleSummarySchema.array().parse(rows);
}

// TODO(U-038): first caller
export async function getPublishedHelpArticle(
  slug: string,
): Promise<HelpArticle | null> {
  const parsed = SlugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const [row] = await dbRead
    .select()
    .from(helpArticles)
    .where(
      and(
        eq(helpArticles.slug, parsed.data),
        eq(helpArticles.status, 'published'),
      ),
    );
  return row ? HelpArticleSchema.parse(row) : null;
}

// ---- Staff reads: every status, for the editor ----

// TODO(U-076b): first caller
export async function listCollectionsForEditing(
  caller: Caller,
): Promise<Collection[]> {
  requireStaff(caller);
  return readCollections(undefined, false);
}

// TODO(U-076b): first caller
export async function listHomeModulesForEditing(
  caller: Caller,
): Promise<HomeModule[]> {
  requireStaff(caller);
  const rows = await dbRead
    .select()
    .from(homeModules)
    .orderBy(asc(homeModules.position));
  return HomeModuleSchema.array().parse(rows);
}

async function readPageCopyForEditing(kind: PageCopyKind): Promise<PageCopy[]> {
  const target = kind === 'category' ? categories : neighborhoods;
  const link = kind === 'category' ? pages.categoryId : pages.neighborhoodId;
  const rows = await dbRead
    .select({ page: pages, slug: target.slug })
    .from(pages)
    .innerJoin(target, eq(link, target.id))
    .orderBy(asc(target.slug))
    .limit(editorialLimits.listed);
  return PageCopySchema.array().parse(
    rows.map(({ page, slug }) => ({ ...page, kind, slug })),
  );
}

// TODO(U-076c): first caller
export async function listPageCopyForEditing(
  caller: Caller,
): Promise<PageCopy[]> {
  requireStaff(caller);
  return [
    ...(await readPageCopyForEditing('category')),
    ...(await readPageCopyForEditing('neighborhood')),
  ];
}

// TODO(U-076c): first caller
export async function listHelpArticlesForEditing(
  caller: Caller,
): Promise<HelpArticle[]> {
  requireStaff(caller);
  const rows = await dbRead
    .select()
    .from(helpArticles)
    .orderBy(
      asc(helpArticles.position),
      asc(helpArticles.title),
      asc(helpArticles.id),
    )
    .limit(editorialLimits.listed);
  return HelpArticleSchema.array().parse(rows);
}

// ---- Staff writes ----
// Each save commits, then invalidates the tags of what guests could see before and after it.
// `updateTag` works only inside a Server Action, which is where these are called.

type Saved<V> = { status: 'saved'; value: V; changes: CacheChange[] };

/** Invalidates after the commit, and hands the caller the saved value without the bookkeeping. */
function finish<V, Other extends { status: string }>(
  outcome: Saved<V> | Other,
): { status: 'saved'; value: V } | Other {
  if (outcome.status !== 'saved') return outcome;
  const { value, changes } = outcome as Saved<V>;
  updateTagsForChanges(changes);
  return { status: 'saved', value };
}

export type SaveCollectionResult =
  | { status: 'saved'; value: Collection }
  | { status: 'not_found' }
  | { status: 'slug_taken' }
  | { status: 'gift_guide_exists' }
  | { status: 'unknown_experience' };

// TODO(U-076b): first caller
/**
 * Creates a collection (no `id`) or replaces one and its whole item list. An `id` that does not
 * match a collection of the same kind is `not_found`: a collection never changes kind.
 */
export async function saveCollection(
  caller: Caller,
  input: CollectionInput,
): Promise<SaveCollectionResult> {
  requireStaff(caller);
  const parsed = CollectionInputSchema.parse(input);
  const outcome = await db.transaction(async (tx) => {
    const [before] = parsed.id
      ? await tx
          .select()
          .from(collections)
          .where(
            and(
              eq(collections.id, parsed.id),
              eq(collections.kind, parsed.kind),
            ),
          )
          .for('update')
      : [];
    if (parsed.id && !before) return { status: 'not_found' } as const;

    const notThis = before ? ne(collections.id, before.id) : undefined;
    const [slugClash] = await tx
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.slug, parsed.slug), notThis))
      .limit(1);
    if (slugClash) return { status: 'slug_taken' } as const;
    if (parsed.kind === 'gift_guide') {
      const [other] = await tx
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.kind, 'gift_guide'), notThis))
        .limit(1);
      if (other) return { status: 'gift_guide_exists' } as const;
    }

    const experienceIds = parsed.items.map((item) => item.experienceId);
    if (experienceIds.length > 0) {
      const known = await tx
        .select({ id: experiences.id })
        .from(experiences)
        .where(inArray(experiences.id, experienceIds));
      if (known.length !== experienceIds.length) {
        return { status: 'unknown_experience' } as const;
      }
    }

    const stamp = publishedAtAfter(before, parsed.status);
    const values = {
      kind: parsed.kind,
      slug: parsed.slug,
      title: parsed.title,
      summary: parsed.summary,
      intro: parsed.intro,
      status: parsed.status,
      publishedAt: stamp === 'now' ? sql`now()` : stamp,
      updatedAt: sql`now()`,
    };
    const [row] = before
      ? await tx
          .update(collections)
          .set(values)
          .where(eq(collections.id, before.id))
          .returning()
      : await tx.insert(collections).values(values).returning();
    if (!row) throw new Error('The collection write returned no row');

    await tx
      .delete(collectionItems)
      .where(eq(collectionItems.collectionId, row.id));
    if (parsed.items.length > 0) {
      await tx.insert(collectionItems).values(
        parsed.items.map((item, position) => ({
          collectionId: row.id,
          experienceId: item.experienceId,
          note: item.note,
          position,
        })),
      );
    }

    return {
      status: 'saved',
      value: CollectionSchema.parse({ ...row, items: parsed.items }),
      changes: changesWhenSaved(
        before &&
          visibleChange(
            before.status,
            collectionChange(before.kind, before.slug),
          ),
        visibleChange(
          parsed.status,
          collectionChange(parsed.kind, parsed.slug),
        ),
      ),
    } as const;
  });
  return finish(outcome);
}

export type SaveHomeModulesResult =
  { status: 'saved'; value: HomeModule[] } | { status: 'unknown_collection' };

// TODO(U-076b): first caller
/** Replaces the whole home page: the position of a module is its place in the list. */
export async function saveHomeModules(
  caller: Caller,
  input: HomeModulesInput,
): Promise<SaveHomeModulesResult> {
  requireStaff(caller);
  const parsed = HomeModulesInputSchema.parse(input);
  const collectionIds = [
    ...new Set(
      parsed.flatMap((module) =>
        module.collectionId === null ? [] : [module.collectionId],
      ),
    ),
  ];
  const outcome = await db.transaction(async (tx) => {
    if (collectionIds.length > 0) {
      const known = await tx
        .select({ id: collections.id })
        .from(collections)
        .where(inArray(collections.id, collectionIds));
      if (known.length !== collectionIds.length) {
        return { status: 'unknown_collection' } as const;
      }
    }
    await tx.delete(homeModules);
    if (parsed.length > 0) {
      await tx
        .insert(homeModules)
        .values(parsed.map((module, position) => ({ ...module, position })));
    }
    const rows = await tx
      .select()
      .from(homeModules)
      .orderBy(asc(homeModules.position));
    return {
      status: 'saved',
      value: HomeModuleSchema.array().parse(rows),
      changes: [{ kind: 'homeModules' }] satisfies CacheChange[],
    } as const;
  });
  return finish(outcome);
}

export type SavePageCopyResult =
  { status: 'saved'; value: PageCopy } | { status: 'unknown_target' };

// TODO(U-076c): first caller
/** Creates the copy of a category or neighborhood page, or replaces what it has. */
export async function savePageCopy(
  caller: Caller,
  input: PageCopyInput,
): Promise<SavePageCopyResult> {
  requireStaff(caller);
  const parsed = PageCopyInputSchema.parse(input);
  const isCategory = parsed.kind === 'category';
  const outcome = await db.transaction(async (tx) => {
    const target = isCategory ? categories : neighborhoods;
    const [owner] = await tx
      .select({ slug: target.slug })
      .from(target)
      .where(eq(target.id, parsed.targetId));
    if (!owner) return { status: 'unknown_target' } as const;

    const [before] = await tx
      .select()
      .from(pages)
      .where(
        eq(
          isCategory ? pages.categoryId : pages.neighborhoodId,
          parsed.targetId,
        ),
      )
      .for('update');

    const stamp = publishedAtAfter(before, parsed.status);
    const values = {
      heading: parsed.heading,
      metaDescription: parsed.metaDescription,
      intro: parsed.intro,
      body: parsed.body,
      status: parsed.status,
      publishedAt: stamp === 'now' ? sql`now()` : stamp,
      updatedAt: sql`now()`,
    };
    const [row] = before
      ? await tx
          .update(pages)
          .set(values)
          .where(eq(pages.id, before.id))
          .returning()
      : await tx
          .insert(pages)
          .values({
            ...values,
            categoryId: isCategory ? parsed.targetId : null,
            neighborhoodId: isCategory ? null : parsed.targetId,
          })
          .returning();
    if (!row) throw new Error('The page copy write returned no row');

    const change = pageCopyChange(parsed.kind, owner.slug);
    return {
      status: 'saved',
      value: PageCopySchema.parse({
        ...row,
        kind: parsed.kind,
        slug: owner.slug,
      }),
      changes: changesWhenSaved(
        before && visibleChange(before.status, change),
        visibleChange(parsed.status, change),
      ),
    } as const;
  });
  return finish(outcome);
}

export type SaveHelpArticleResult =
  | { status: 'saved'; value: HelpArticle }
  | { status: 'not_found' }
  | { status: 'slug_taken' };

// TODO(U-076c): first caller
/** Creates an article (no `id`) or replaces one. */
export async function saveHelpArticle(
  caller: Caller,
  input: HelpArticleInput,
): Promise<SaveHelpArticleResult> {
  requireStaff(caller);
  const parsed = HelpArticleInputSchema.parse(input);
  const outcome = await db.transaction(async (tx) => {
    const [before] = parsed.id
      ? await tx
          .select()
          .from(helpArticles)
          .where(eq(helpArticles.id, parsed.id))
          .for('update')
      : [];
    if (parsed.id && !before) return { status: 'not_found' } as const;

    const [slugClash] = await tx
      .select({ id: helpArticles.id })
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.slug, parsed.slug),
          before ? ne(helpArticles.id, before.id) : undefined,
        ),
      )
      .limit(1);
    if (slugClash) return { status: 'slug_taken' } as const;

    const stamp = publishedAtAfter(before, parsed.status);
    const values = {
      slug: parsed.slug,
      title: parsed.title,
      summary: parsed.summary,
      body: parsed.body,
      position: parsed.position,
      status: parsed.status,
      publishedAt: stamp === 'now' ? sql`now()` : stamp,
      updatedAt: sql`now()`,
    };
    const [row] = before
      ? await tx
          .update(helpArticles)
          .set(values)
          .where(eq(helpArticles.id, before.id))
          .returning()
      : await tx.insert(helpArticles).values(values).returning();
    if (!row) throw new Error('The help article write returned no row');

    const change: CacheChange = { kind: 'helpArticles' };
    return {
      status: 'saved',
      value: HelpArticleSchema.parse(row),
      changes: changesWhenSaved(
        before && visibleChange(before.status, change),
        visibleChange(parsed.status, change),
      ),
    } as const;
  });
  return finish(outcome);
}
