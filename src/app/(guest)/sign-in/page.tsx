import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeading } from '@/components/PageHeading';
import { Skeleton } from '@/components/Skeleton';
import { SignInContent, signInTitle } from './SignInContent';

export const metadata: Metadata = {
  title: signInTitle,
  robots: { index: false },
};

export default function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  return (
    <Suspense
      fallback={
        <PageHeading title={signInTitle}>
          <Skeleton kind="text" />
        </PageHeading>
      }
    >
      <SignInContent searchParams={searchParams} />
    </Suspense>
  );
}
