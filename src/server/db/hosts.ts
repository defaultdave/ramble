import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  bookableStatuses,
  CancellationTierSchema,
  GuestHostSchema,
  SlugSchema,
  type CancellationTier,
  type GuestHost,
} from '@/lib/catalog';
import { cardLookupLimit } from '@/lib/idLookup';
import { guestVisible } from './catalog';
import { dbRead } from './client';
import { cancellationTiers, experiences, hosts } from './schema';

export type HostListing = {
  host: GuestHost;
  /** The host's live experiences by name, at most `cardLookupLimit`, each with the tier its terms come from. */
  live: { id: string; cancellationTier: CancellationTier }[];
};

/**
 * The host with this slug and the IDs of their live experiences, or null when no host has the
 * slug. Hosts have no status of their own; what hides an experience is its status, so a paused or
 * guide-only one is not listed. The cards are read from the IDs by `listHomeExperiences`.
 */
export async function getHostListing(
  slug: string,
): Promise<HostListing | null> {
  const parsedSlug = SlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;
  const [host] = await dbRead
    .select()
    .from(hosts)
    .where(eq(hosts.slug, parsedSlug.data))
    .limit(1);
  if (!host) return null;
  const live = await dbRead
    .select({ id: experiences.id, cancellationTier: cancellationTiers })
    .from(experiences)
    .innerJoin(
      cancellationTiers,
      eq(cancellationTiers.id, experiences.cancellationTierId),
    )
    .where(
      and(
        eq(experiences.hostId, host.id),
        guestVisible,
        inArray(experiences.status, bookableStatuses),
      ),
    )
    .orderBy(asc(experiences.name), asc(experiences.id))
    .limit(cardLookupLimit);
  return {
    host: GuestHostSchema.parse(host),
    live: live.map(({ id, cancellationTier }) => ({
      id,
      cancellationTier: CancellationTierSchema.parse(cancellationTier),
    })),
  };
}
