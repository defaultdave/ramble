import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BrowseSkeleton } from '@/components/BrowseSkeleton';
import { browseTitle } from '@/lib/browse';
import { isIndexable, parseFilters } from '@/lib/filters';
import { getFilterOptions } from '@/server/browse';
import { BrowseContent } from './BrowseContent';
import styles from './page.module.css';

export async function generateMetadata({
  searchParams,
}: PageProps<'/new-york/browse'>): Promise<Metadata> {
  const query = parseFilters(await searchParams);
  return {
    title: browseTitle(query.filters, await getFilterOptions()),
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
