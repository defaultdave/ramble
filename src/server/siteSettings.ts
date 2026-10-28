import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import type { GuestSettings } from '@/lib/settings';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { getGuestSettings } from '@/server/db/settings';

/** The banner and the switches a guest page shows. Saving settings invalidates `tags.settings`. */
export async function getCachedGuestSettings(): Promise<GuestSettings> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);
  return readOrRefuse('Settings', () => getGuestSettings());
}
