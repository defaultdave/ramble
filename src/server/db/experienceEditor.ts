import 'server-only';
import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CacheChange } from '@/lib/cacheTags';
import {
  EntityIdSchema,
  experienceStatuses,
  HostExperienceSchema,
  WriteIdSchema,
} from '@/lib/catalog';
import {
  experienceCreatedEntry,
  experienceUpdatedEntry,
} from '@/lib/experienceAudit';
import {
  buildExperienceChoices,
  buildExperienceEditView,
  changedExperienceFields,
  desiredPriceOptions,
  experienceChoiceLimits,
  experienceColumnsOf,
  experienceContentOf,
  experienceRuleFailures,
  isGuestVisible,
  listingChanges,
  experiencesPageSize,
  removedPriceFields,
  type ExperienceChoices,
  type ExperienceContent,
  type ExperienceCreateInput,
  type ExperienceEditView,
  type ExperienceFilters,
  type ExperienceFormField,
  type ExperienceListRow,
  type PlaceSlugs,
} from '@/lib/experienceEditor';
import { legalKindOf } from '@/lib/legal';
import { splitPage } from '@/lib/pagination';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { requireOpsUserId, writeAudit } from './audit';
import { listCategories, listNeighborhoods } from './catalog';
import { db, dbRead, type Transaction } from './client';
import { listCancellationTiers } from './policies';
import {
  categories,
  experiences,
  hosts,
  legalDocuments,
  neighborhoods,
  priceOptions,
  cancellationTiers,
} from './schema';

// Everything here is for the ops role, and each function checks it before it reads or writes. A
// save is one transaction holding the experience row, its price options and its audit row. A
// change to an experience guests can see invalidates its cache tags after the commit, so these run
// in a Server Action only.

const FiltersSchema = z.object({
  status: z.enum(experienceStatuses).nullable(),
  hostId: EntityIdSchema.nullable(),
  categoryId: EntityIdSchema.nullable(),
});

export type ExperiencesPage = {
  rows: ExperienceListRow[];
  nextCursor: string | null;
};

/** One page of experiences by name, filtered by status, host and category. */
export async function readExperiencesForOps(
  caller: Caller,
  filters: ExperienceFilters,
  cursor: string | null,
): Promise<ExperiencesPage> {
  requireRole(caller, Role.Ops, {});
  const parsed = FiltersSchema.parse(filters);
  const parsedCursor = cursor === null ? null : EntityIdSchema.parse(cursor);
  const fetched = await dbRead
    .select({
      id: experiences.id,
      name: experiences.name,
      status: experiences.status,
      hostName: hosts.name,
      categoryName: categories.name,
    })
    .from(experiences)
    .innerJoin(hosts, eq(hosts.id, experiences.hostId))
    .innerJoin(categories, eq(categories.id, experiences.categoryId))
    .where(
      and(
        parsed.status === null
          ? undefined
          : eq(experiences.status, parsed.status),
        parsed.hostId === null
          ? undefined
          : eq(experiences.hostId, parsed.hostId),
        parsed.categoryId === null
          ? undefined
          : eq(experiences.categoryId, parsed.categoryId),
        parsedCursor === null
          ? undefined
          : sql`(${experiences.name}, ${experiences.id}) > (SELECT e.name, e.id FROM experiences e WHERE e.id = ${parsedCursor})`,
      ),
    )
    .orderBy(asc(experiences.name), asc(experiences.id))
    .limit(experiencesPageSize + 1);
  const { items, nextCursor } = splitPage(fetched, experiencesPageSize);
  return { rows: items, nextCursor };
}

/** The choices a list filter or a form offers: hosts, categories, neighborhoods, the shared cancellation tiers, and the published waivers. */
export async function readExperienceChoices(
  caller: Caller,
): Promise<ExperienceChoices> {
  requireRole(caller, Role.Ops, {});
  const [hostRows, categoryRows, neighborhoodRows, tiers, waivers] =
    await Promise.all([
      dbRead
        .select({ id: hosts.id, name: hosts.name })
        .from(hosts)
        .orderBy(asc(hosts.name), asc(hosts.id))
        .limit(experienceChoiceLimits.hosts),
      listCategories(),
      listNeighborhoods(),
      listCancellationTiers(),
      dbRead
        .select({
          id: legalDocuments.id,
          title: legalDocuments.title,
          version: legalDocuments.version,
        })
        .from(legalDocuments)
        .where(
          and(
            like(legalDocuments.doc, 'waiver-%'),
            eq(legalDocuments.status, 'published'),
          ),
        )
        .orderBy(asc(legalDocuments.doc), desc(legalDocuments.version))
        .limit(experienceChoiceLimits.waivers),
    ]);
  return buildExperienceChoices({
    hosts: hostRows,
    categories: categoryRows,
    neighborhoods: neighborhoodRows,
    cancellationTiers: tiers,
    waivers,
  });
}

/** One experience in any status, with its host's name, or null for an id that is no experience. */
export async function readExperienceForOps(
  caller: Caller,
  experienceId: string,
): Promise<ExperienceEditView | null> {
  requireRole(caller, Role.Ops, {});
  const parsedId = EntityIdSchema.safeParse(experienceId);
  if (!parsedId.success) return null;
  const row = await dbRead.query.experiences.findFirst({
    where: eq(experiences.id, parsedId.data),
    with: {
      host: true,
      cancellationTier: true,
      priceOptions: { orderBy: [asc(priceOptions.kind)] },
    },
  });
  if (!row) return null;
  return buildExperienceEditView(
    HostExperienceSchema.parse(row),
    row.host.name,
  );
}

type References = Pick<
  ExperienceContent,
  'categoryId' | 'neighborhoodId' | 'cancellationTierId' | 'waiverDocumentId'
> & { hostId?: string };

/** Whether every row the content points at is there, and the waiver is a published waiver. Reference data is never deleted, so this only catches a stale form. */
async function referencesExist(
  tx: Transaction,
  refs: References,
): Promise<boolean> {
  const found = async (rows: PromiseLike<readonly unknown[]>) =>
    (await rows).length > 0;
  if (
    refs.hostId !== undefined &&
    !(await found(
      tx.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, refs.hostId)),
    ))
  ) {
    return false;
  }
  const checks = [
    tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, refs.categoryId)),
    tx
      .select({ id: neighborhoods.id })
      .from(neighborhoods)
      .where(eq(neighborhoods.id, refs.neighborhoodId)),
    tx
      .select({ id: cancellationTiers.id })
      .from(cancellationTiers)
      .where(eq(cancellationTiers.id, refs.cancellationTierId)),
  ];
  for (const check of checks) {
    if (!(await found(check))) return false;
  }
  if (refs.waiverDocumentId === null) return true;
  const [waiver] = await tx
    .select({ doc: legalDocuments.doc, status: legalDocuments.status })
    .from(legalDocuments)
    .where(eq(legalDocuments.id, refs.waiverDocumentId));
  return waiver?.status === 'published' && legalKindOf(waiver.doc) === 'waiver';
}

async function writePriceOptions(
  tx: Transaction,
  experienceId: string,
  content: ExperienceContent,
): Promise<void> {
  const options = desiredPriceOptions(content);
  if (options.length === 0) return;
  await tx
    .insert(priceOptions)
    .values(options.map((option) => ({ experienceId, ...option })))
    .onConflictDoUpdate({
      target: [priceOptions.experienceId, priceOptions.kind],
      set: {
        priceMinor: sql`excluded.price_minor`,
        usesSpace: sql`excluded.uses_space`,
      },
    });
}

export type CreateExperienceResult =
  { status: 'created'; experienceId: string } | { status: 'reference_missing' };

/** Makes a draft experience for the host with its price options and an audit row. A choice that is no longer there writes nothing. */
export async function createExperience(
  caller: Caller,
  input: ExperienceCreateInput,
): Promise<CreateExperienceResult> {
  const userId = requireOpsUserId(caller);
  return db.transaction(async (tx) => {
    if (!(await referencesExist(tx, input))) {
      return { status: 'reference_missing' } as const;
    }
    const [created] = await tx
      .insert(experiences)
      .values({ hostId: input.hostId, ...experienceColumnsOf(input) })
      .returning({ id: experiences.id });
    if (!created) throw new Error('The experience write returned no row');
    await writePriceOptions(tx, created.id, input);
    await writeAudit(
      tx,
      experienceCreatedEntry(userId, created.id, input.hostId),
    );
    return { status: 'created', experienceId: created.id } as const;
  });
}

export type UpdateExperienceResult =
  | { status: 'updated' | 'unchanged' | 'not_found' | 'reference_missing' }
  | { status: 'invalid'; fields: ExperienceFormField[] };

type Saved = { result: UpdateExperienceResult; changes: CacheChange[] };

/**
 * Saves the experience's content and prices. Nothing differing writes nothing, audit row
 * included. A rule that depends on the status (a guide entry links out) and a price taken away
 * are refused with the fields to look at. A change to a listing guests can see invalidates its
 * tags, for the old and the new place.
 */
export async function updateExperience(
  caller: Caller,
  experienceId: string,
  input: ExperienceContent,
): Promise<UpdateExperienceResult> {
  const userId = requireOpsUserId(caller);
  const parsedId = WriteIdSchema.safeParse(experienceId);
  if (!parsedId.success) return { status: 'not_found' };
  const id = parsedId.data;

  const saved = await db.transaction(async (tx): Promise<Saved> => {
    const [current] = await tx
      .select()
      .from(experiences)
      .where(eq(experiences.id, id))
      .for('update');
    if (!current) return { result: { status: 'not_found' }, changes: [] };
    const prices = await tx
      .select()
      .from(priceOptions)
      .where(eq(priceOptions.experienceId, id));
    const before = experienceContentOf(current, prices);
    const changed = changedExperienceFields(before, input);
    if (changed.length === 0) {
      return { result: { status: 'unchanged' }, changes: [] };
    }

    const refused = [
      ...experienceRuleFailures(input, current.status),
      ...removedPriceFields(before, input),
    ];
    if (refused.length > 0) {
      return { result: { status: 'invalid', fields: refused }, changes: [] };
    }
    if (!(await referencesExist(tx, input))) {
      return { result: { status: 'reference_missing' }, changes: [] };
    }

    await tx
      .update(experiences)
      .set(experienceColumnsOf(input))
      .where(eq(experiences.id, id));
    await writePriceOptions(tx, id, input);
    await writeAudit(tx, experienceUpdatedEntry(userId, id, changed, input));
    const changes = isGuestVisible(current.status)
      ? listingChanges(
          id,
          await placeSlugs(tx, before),
          await placeSlugs(tx, input),
        )
      : [];
    return { result: { status: 'updated' }, changes };
  });
  // After the commit, so a save that rolled back invalidates nothing.
  updateTagsForChanges(saved.changes);
  return saved.result;
}

/** The slugs a listing's cache tags are built from. */
async function placeSlugs(
  tx: Transaction,
  content: Pick<ExperienceContent, 'categoryId' | 'neighborhoodId'>,
): Promise<PlaceSlugs> {
  const [category] = await tx
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, content.categoryId));
  const [neighborhood] = await tx
    .select({ slug: neighborhoods.slug })
    .from(neighborhoods)
    .where(eq(neighborhoods.id, content.neighborhoodId));
  if (!category || !neighborhood) throw new Error('A place slug was not found');
  return { categorySlug: category.slug, neighborhoodSlug: neighborhood.slug };
}
