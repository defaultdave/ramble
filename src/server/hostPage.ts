import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { isHostSlug, type HostPageData } from '@/lib/pages/host';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { tagExperiences } from '@/server/cache/tagExperiences';
import { listHomeExperiences } from '@/server/db/home';
import { getHostListing } from '@/server/db/hosts';

/**
 * A host with their live experiences as cards, or null when the address is not a slug or no host
 * has it. A malformed address is refused before the cache is asked. Publishing, editing, or taking
 * down one of the host's experiences reaches the entry through that experience's tag, and `catalog`
 * covers one that was hidden when the entry was made, as for a collection. Nothing reaches the
 * host's own name or about text, so an edit shows when the profile runs out. A miss is not kept
 * (the `uncached` profile), so made-up addresses fill nothing.
 */
export async function getHostPage(slug: string): Promise<HostPageData | null> {
  if (!isHostSlug(slug)) return null;
  return readHostPage(slug);
}

async function readHostPage(slug: string): Promise<HostPageData | null> {
  'use cache';
  cacheLife('catalog');
  cacheTag(tags.catalog);
  const listing = await readOrRefuse('Host page', () => getHostListing(slug));
  if (!listing) {
    cacheLife('uncached');
    return null;
  }
  const ids = listing.live.map(({ id }) => id);
  tagExperiences(ids);
  const experiences =
    ids.length === 0
      ? []
      : await readOrRefuse('Host experiences', () =>
          listHomeExperiences(ids, { covers: true }),
        );
  return {
    host: listing.host,
    experiences,
    tiers: listing.live.map(({ id, cancellationTier }) => ({
      experienceId: id,
      tier: cancellationTier,
    })),
  };
}
