import { ButtonLink } from '@/components/Button';
import { PageHeading } from '@/components/PageHeading';

export function NotFoundNotice() {
  return (
    <PageHeading title="We can't find that page">
      <p>The link may be old or mistyped.</p>
      <ButtonLink href="/" variant="primary">
        Go to the Ramble home page
      </ButtonLink>
    </PageHeading>
  );
}
