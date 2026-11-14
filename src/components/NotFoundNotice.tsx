import { ButtonLink } from '@/components/Button';
import { PageHeading } from '@/components/PageHeading';
import { commonCopy } from '@/lib/copy/common';

export function NotFoundNotice() {
  return (
    <PageHeading title={commonCopy.notFound.title}>
      <p>{commonCopy.notFound.body}</p>
      <ButtonLink href="/" variant="primary">
        {commonCopy.notFound.homeLink}
      </ButtonLink>
    </PageHeading>
  );
}
