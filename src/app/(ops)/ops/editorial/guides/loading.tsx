import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';

export default function GuideEntriesLoading() {
  return (
    <PageHeading title={opsEditorialContentCopy.guides.title}>
      <p role="status">{opsEditorialContentCopy.loading}</p>
    </PageHeading>
  );
}
