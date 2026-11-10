import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeading } from '@/components/PageHeading';
import { Skeleton } from '@/components/Skeleton';
import { ConfirmContent, confirmTitle } from './ConfirmContent';

// The address holds the link's token, so it is kept out of search results and out of the Referer. The policy is `origin`, not `no-referrer`: that one makes the browser send `Origin: null` on the form post.
export const metadata: Metadata = {
  title: confirmTitle,
  robots: { index: false, follow: false },
  referrer: 'origin',
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
