import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import type { HelpArticle, HelpArticleSummary } from '@/lib/editorial';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import {
  getPublishedHelpArticle,
  listPublishedHelpArticles,
} from '@/server/db/editorial';
import { searchPublishedHelpArticles } from '@/server/db/help';

/** Saving a help article invalidates `tags.helpArticles`. */
export async function getHelpIndex(): Promise<HelpArticleSummary[]> {
  'use cache';
  cacheLife('editorial');
  cacheTag(tags.helpArticles);
  return readOrRefuse('Help index', () => listPublishedHelpArticles());
}

export async function getHelpArticle(
  slug: string,
): Promise<HelpArticle | null> {
  'use cache';
  cacheLife('editorial');
  cacheTag(tags.helpArticles);
  return readOrRefuse('Help article', () => getPublishedHelpArticle(slug));
}

/** Not cached: a search term is free text, so an entry per term would grow without a bound. */
export function searchHelp(term: string): Promise<HelpArticleSummary[]> {
  return searchPublishedHelpArticles(term);
}
