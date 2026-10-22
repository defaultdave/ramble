import { PageHeading } from '@/components/PageHeading';

type ErrorNoticeProps = { onRetry: () => void };

export function ErrorNotice({ onRetry }: ErrorNoticeProps) {
  return (
    <PageHeading title="Something went wrong on our side">
      <p>This page did not load. Try again in a moment.</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </PageHeading>
  );
}
