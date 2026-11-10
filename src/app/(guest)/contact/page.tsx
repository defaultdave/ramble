import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeading } from '@/components/PageHeading';
import { Skeleton } from '@/components/Skeleton';
import { ContactContent } from './ContactContent';

export const metadata: Metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <PageHeading title="Contact us">
      <p>
        Most questions are answered in the <Link href="/help">help center</Link>
        . If yours is not, write to us here.
      </p>
      <Suspense fallback={<Skeleton kind="text" />}>
        <ContactContent />
      </Suspense>
    </PageHeading>
  );
}
