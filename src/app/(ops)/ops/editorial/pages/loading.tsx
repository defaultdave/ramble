import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';

export default function PageCopyLoading() {
  return (
    <PageHeading title={opsEditorialContentCopy.pages.title}>
      <p role="status">{opsEditorialContentCopy.loading}</p>
    </PageHeading>
  );
}
