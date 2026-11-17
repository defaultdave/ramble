import { PageHeading } from '@/components/PageHeading';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';

export default function HomeModulesLoading() {
  return (
    <PageHeading title={opsEditorialSectionsCopy.home.title}>
      <p role="status">Loading…</p>
    </PageHeading>
  );
}
