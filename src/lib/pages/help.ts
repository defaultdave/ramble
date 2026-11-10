import type { HelpArticleSummary } from '@/lib/editorial';
import { helpPath } from '@/lib/paths';

export const helpTitle = 'Help';
export const helpArticleFallbackTitle = 'Help article';
export const helpSearchMaxLength = 80;

const helpDescription =
  'Answers about booking, changing a booking, gifts, and hosts on Ramble.';

export const helpArticlePath = (slug: string) => `${helpPath}/${slug}`;

/**
 * The search a guest typed, or null when there is nothing to search for. The first value of a
 * repeated `q` wins; whitespace is collapsed and the length is capped, so the read never sees a
 * megabyte of input.
 */
export function parseHelpQuery(
  raw: string | string[] | undefined,
): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const term = (first ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, helpSearchMaxLength)
    .trim();
  return term === '' ? null : term;
}

/** The pattern an ILIKE matches a title against: the term anywhere in it, with `\`, `%` and `_` taken literally. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

export type HelpIndexView =
  | { kind: 'articles'; articles: readonly HelpArticleSummary[] }
  | { kind: 'results'; query: string; articles: readonly HelpArticleSummary[] }
  | { kind: 'none'; query: string };

/** What the index shows: every article, the matches for a search, or the no-results state. */
export function buildHelpIndex(
  query: string | null,
  articles: readonly HelpArticleSummary[],
): HelpIndexView {
  if (query === null) return { kind: 'articles', articles };
  return articles.length === 0
    ? { kind: 'none', query }
    : { kind: 'results', query, articles };
}

type HelpHead = {
  title: string;
  description?: string;
  robots?: { index: boolean; follow: boolean };
};

/** The plain head of the index. */
function indexHead(): HelpHead {
  return { title: helpTitle, description: helpDescription };
}

/** A searched index is a view of the same page, so it stays out of the index. */
export function helpIndexHead(query: string | null): HelpHead {
  return query === null
    ? indexHead()
    : { ...indexHead(), robots: { index: false, follow: true } };
}

export function helpArticleHead(
  article: { title: string; summary: string | null } | null,
): HelpHead {
  if (!article) return { title: 'Help article not found' };
  return article.summary
    ? { title: article.title, description: article.summary }
    : { title: article.title };
}
