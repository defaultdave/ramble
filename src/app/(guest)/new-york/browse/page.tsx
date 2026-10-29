import type { Metadata } from 'next';
import { unstable_rethrow } from 'next/navigation';
import { Suspense } from 'react';
import { BrowseSkeleton } from '@/components/BrowseSkeleton';
import { browseTitle } from '@/lib/browse';
import { isIndexable, parseFilters } from '@/lib/filters';
import { getFilterOptions } from '@/server/browse';
import { BrowseContent } from './BrowseContent';
import styles from './page.module.css';

/** Chosen filters named in the title. A failed read leaves the names out; the title still has the day. */
async function filterNames() {
  try {
    const { categories, neighborhoods } = await getFilterOptions();
    const bySlug = (rows: readonly { slug: string; name: string }[]) =>
      new Map(rows.map(({ slug, name }) => [slug, name]));
    return {
      categories: bySlug(categories),
      neighborhoods: bySlug(neighborhoods),
    };
  } catch (error) {
    // Next.js ends a prerender by throwing; swallowing that would break the render.
    unstable_rethrow(error);
    return {
      categories: new Map<string, string>(),
      neighborhoods: new Map<string, string>(),
    };
  }
}

export async function generateMetadata({
  searchParams,
}: PageProps<'/new-york/browse'>): Promise<Metadata> {
  const query = parseFilters(await searchParams);
  return {
    title: browseTitle(query.filters, await filterNames()),
    robots: isIndexable(query) ? undefined : { index: false, follow: true },
  };
}

export default function BrowsePage({
  searchParams,
}: PageProps<'/new-york/browse'>) {
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1 className={styles.title}>Browse experiences</h1>
        <p className={styles.lede}>
          Classes, tours, and tastings run by people who know their block.
          Narrow them down by day, neighborhood, or kind.
        </p>
      </header>
      <Suspense fallback={<BrowseSkeleton />}>
        <BrowseContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
