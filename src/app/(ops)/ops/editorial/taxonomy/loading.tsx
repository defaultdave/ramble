import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';

export default function TaxonomyLoading() {
  return (
    <PageHeading title={opsEditorialContentCopy.taxonomy.title}>
      <p role="status">{opsEditorialContentCopy.loading}</p>
    </PageHeading>
  );
}
