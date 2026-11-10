import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeading } from '@/components/PageHeading';
import { Skeleton } from '@/components/Skeleton';
import { ConfirmContent, confirmTitle } from './ConfirmContent';

// The address holds the link's token, so it is kept out of search results and out of the Referer.
export const metadata: Metadata = {
  title: confirmTitle,
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ConfirmSignInPage({
  searchParams,
}: PageProps<'/sign-in/confirm'>) {
  return (
    <Suspense
      fallback={
        <PageHeading title={confirmTitle}>
          <Skeleton kind="text" />
        </PageHeading>
      }
    >
      <ConfirmContent searchParams={searchParams} />
    </Suspense>
  );
}
