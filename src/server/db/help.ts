import 'server-only';
import { and, asc, eq, ilike } from 'drizzle-orm';
import {
  HelpArticleSummarySchema,
  editorialLimits,
  type HelpArticleSummary,
} from '@/lib/editorial';
import { containsPattern } from '@/lib/pages/help';
import { dbRead } from './client';
import { helpArticles } from './schema';

/** Published articles whose title contains the term, in the order of the index. The term is matched literally. */
export async function searchPublishedHelpArticles(
  term: string,
): Promise<HelpArticleSummary[]> {
  const rows = await dbRead
    .select()
    .from(helpArticles)
    .where(
      and(
        eq(helpArticles.status, 'published'),
        ilike(helpArticles.title, containsPattern(term)),
      ),
    )
    .orderBy(
      asc(helpArticles.position),
      asc(helpArticles.title),
      asc(helpArticles.id),
    )
    .limit(editorialLimits.listed);
  return HelpArticleSummarySchema.array().parse(rows);
}
