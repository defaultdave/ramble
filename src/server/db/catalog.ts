import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  CategorySchema,
  EntityIdSchema,
  GuestExperienceSchema,
  HostExperienceSchema,
  NeighborhoodSchema,
  RetiredSlugSchema,
  SlugSchema,
  guestVisibleStatuses,
  slugEntityKinds,
  type Category,
  type GuestExperience,
  type HostExperience,
  type Neighborhood,
  type RetiredSlug,
} from '@/lib/catalog';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { dbRead } from './client';
import {
  categories,
  experiences,
  neighborhoods,
  priceOptions,
  slugHistory,
} from './schema';

// The only place that decides what a guest may see. Every guest read goes through it.
const guestVisible = inArray(experiences.status, [...guestVisibleStatuses]);

const byNameThenId = [asc(experiences.name), asc(experiences.id)];

const adultFirst = [asc(priceOptions.kind)];

const RetiredSlugQuerySchema = z.object({
  kind: z.enum(slugEntityKinds),
  slug: SlugSchema,
});

// TODO(U-031): first caller
/** Every experience a guest can see. Filtering and paging happen in memory, in the browse page. */
export async function listGuestExperiences(): Promise<GuestExperience[]> {
  const rows = await dbRead.query.experiences.findMany({
    where: guestVisible,
    with: {
      host: true,
      cancellationTier: true,
      priceOptions: { orderBy: adultFirst },
    },
    orderBy: byNameThenId,
  });
  return GuestExperienceSchema.array().parse(rows);
}

// TODO(U-039): first caller
/** Null when the ID is malformed, the row is missing, or its status is not visible to guests. */
export async function getGuestExperience(
  id: string,
): Promise<GuestExperience | null> {
  const parsedId = EntityIdSchema.safeParse(id);
  if (!parsedId.success) return null;
  const row = await dbRead.query.experiences.findFirst({
    where: and(eq(experiences.id, parsedId.data), guestVisible),
    with: {
      host: true,
      cancellationTier: true,
      priceOptions: { orderBy: adultFirst },
    },
  });
  return row ? GuestExperienceSchema.parse(row) : null;
}

// TODO(U-031): first caller
export async function listCategories(): Promise<Category[]> {
  const rows = await dbRead
    .select()
    .from(categories)
    .orderBy(asc(categories.name), asc(categories.id));
  return CategorySchema.array().parse(rows);
}

// TODO(U-031): first caller
export async function listNeighborhoods(): Promise<Neighborhood[]> {
  const rows = await dbRead
    .select()
    .from(neighborhoods)
    .orderBy(asc(neighborhoods.name), asc(neighborhoods.id));
  return NeighborhoodSchema.array().parse(rows);
}

// TODO(U-035): first caller
export async function getCategoryBySlug(
  slug: string,
): Promise<Category | null> {
  const parsedSlug = SlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;
  const [row] = await dbRead
    .select()
    .from(categories)
    .where(eq(categories.slug, parsedSlug.data));
  return row ? CategorySchema.parse(row) : null;
}

// TODO(U-035): first caller
export async function getNeighborhoodBySlug(
  slug: string,
): Promise<Neighborhood | null> {
  const parsedSlug = SlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;
  const [row] = await dbRead
    .select()
    .from(neighborhoods)
    .where(eq(neighborhoods.slug, parsedSlug.data));
  return row ? NeighborhoodSchema.parse(row) : null;
}

// TODO(U-091): first caller
/** Which entity used to hold this slug. The caller checks the live slug first and redirects only on a miss. */
export async function findRetiredSlug(
  kind: RetiredSlug['entityKind'],
  slug: string,
): Promise<RetiredSlug | null> {
  const query = RetiredSlugQuerySchema.safeParse({ kind, slug });
  if (!query.success) return null;
  const [row] = await dbRead
    .select()
    .from(slugHistory)
    .where(
      and(
        eq(slugHistory.entityKind, query.data.kind),
        eq(slugHistory.slug, query.data.slug),
      ),
    );
  return row ? RetiredSlugSchema.parse(row) : null;
}

// TODO(U-074b): first caller
/** Every experience of the host in any status, for the host's owner. A malformed host ID lists nothing. */
export async function listHostExperiences(
  caller: Caller,
  hostId: string,
): Promise<HostExperience[]> {
  const parsedHostId = EntityIdSchema.safeParse(hostId);
  if (!parsedHostId.success) return [];
  requireRole(caller, Role.HostOwner, { hostId: parsedHostId.data });
  const rows = await dbRead.query.experiences.findMany({
    where: eq(experiences.hostId, parsedHostId.data),
    with: {
      cancellationTier: true,
      priceOptions: { orderBy: adultFirst },
    },
    orderBy: byNameThenId,
  });
  return HostExperienceSchema.array().parse(rows);
}

// TODO(U-074b): first caller
/** The row is read once and its host checked before it is returned, so the owner of another host learns nothing from it. */
export async function getHostExperience(
  caller: Caller,
  id: string,
): Promise<HostExperience | null> {
  const parsedId = EntityIdSchema.safeParse(id);
  if (!parsedId.success) return null;
  const row = await dbRead.query.experiences.findFirst({
    where: eq(experiences.id, parsedId.data),
    with: {
      cancellationTier: true,
      priceOptions: { orderBy: adultFirst },
    },
  });
  if (!row) return null;
  requireRole(caller, Role.HostOwner, { hostId: row.hostId });
  return HostExperienceSchema.parse(row);
}
