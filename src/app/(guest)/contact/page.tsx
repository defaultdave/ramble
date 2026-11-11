import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeading } from '@/components/PageHeading';
import { Skeleton } from '@/components/Skeleton';
import { ContactContent, contactTitle } from './ContactContent';

export const metadata: Metadata = { title: contactTitle };

export default function ContactPage() {
  return (
    <Suspense
      fallback={
        <PageHeading title={contactTitle}>
          <Skeleton kind="text" />
        </PageHeading>
      }
    >
      <ContactContent />
    </Suspense>
  );
}
