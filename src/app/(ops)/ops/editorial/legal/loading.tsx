import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';

export default function LegalDocumentsLoading() {
  return (
    <PageHeading title={opsEditorialContentCopy.legal.title}>
      <p role="status">{opsEditorialContentCopy.loading}</p>
    </PageHeading>
  );
}
