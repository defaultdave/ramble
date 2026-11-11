import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeading } from '@/components/PageHeading';
import { Skeleton } from '@/components/Skeleton';
import {
  PrivateSessionContent,
  privateSessionTitle,
} from './PrivateSessionContent';

export const metadata: Metadata = { title: privateSessionTitle };

export function generateStaticParams() {
  return [{ slugAndId: 'sample' }];
}

export default function PrivateSessionPage({
  params,
}: PageProps<'/experiences/[slugAndId]/private-session'>) {
  return (
    <Suspense
      fallback={
        <PageHeading title={privateSessionTitle}>
          <Skeleton kind="text" />
        </PageHeading>
      }
    >
      <PrivateSessionContent slugAndId={params.then((p) => p.slugAndId)} />
    </Suspense>
  );
}
