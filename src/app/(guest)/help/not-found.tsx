import { ButtonLink } from '@/components/Button';
import { PageHeading } from '@/components/PageHeading';
import { helpPath } from '@/lib/paths';

export default function HelpNotFound() {
  return (
    <PageHeading title="We can't find that help article">
      <p>The link may be old, or the article may have been taken down.</p>
      <ButtonLink href={helpPath} variant="primary">
        Browse all help articles
      </ButtonLink>
    </PageHeading>
  );
}
