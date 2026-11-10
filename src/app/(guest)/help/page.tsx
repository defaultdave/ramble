import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeading } from '@/components/PageHeading';
import { helpIndexHead, helpTitle, parseHelpQuery } from '@/lib/pages/help';
import { HelpContent } from './HelpContent';

export async function generateMetadata({
  searchParams,
}: PageProps<'/help'>): Promise<Metadata> {
  return helpIndexHead(parseHelpQuery((await searchParams).q));
}

export default function HelpPage({ searchParams }: PageProps<'/help'>) {
  return (
    <Suspense fallback={<PageHeading title={helpTitle} />}>
      <HelpContent searchParams={searchParams} />
    </Suspense>
  );
}
