import { Button } from '@/components/Button';
import { PageHeading } from '@/components/PageHeading';

type ErrorNoticeProps = { onRetry: () => void };

export function ErrorNotice({ onRetry }: ErrorNoticeProps) {
  return (
    <PageHeading title="Something went wrong on our side">
      <p>This page did not load. Try again in a moment.</p>
      <Button type="button" variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </PageHeading>
  );
}
