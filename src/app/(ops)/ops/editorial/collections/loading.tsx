import { PageHeading } from '@/components/PageHeading';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';

export default function CollectionsLoading() {
  return (
    <PageHeading title={opsEditorialSectionsCopy.collections.title}>
      <p role="status">{opsEditorialSectionsCopy.loading}</p>
    </PageHeading>
  );
}
