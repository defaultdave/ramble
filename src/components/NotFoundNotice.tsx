import Link from 'next/link';
import { PageHeading } from '@/components/PageHeading';

export function NotFoundNotice() {
  return (
    <PageHeading title="We can't find that page">
      <p>The link may be old or mistyped.</p>
      <Link href="/">Go to the Ramble home page</Link>
    </PageHeading>
  );
}
