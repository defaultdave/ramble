import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeading } from '@/components/PageHeading';
import { Skeleton } from '@/components/Skeleton';
import { AccountContent, accountTitle } from './AccountContent';

export const metadata: Metadata = {
  title: accountTitle,
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <PageHeading title={accountTitle}>
          <Skeleton kind="text" />
        </PageHeading>
      }
    >
      <AccountContent />
    </Suspense>
  );
}
