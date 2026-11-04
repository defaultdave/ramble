import { useEffect, useRef } from 'react';
import { Button } from '@/components/Button';
import { PageHeading } from '@/components/PageHeading';

type ErrorNoticeProps = { onRetry: () => void };

export function ErrorNotice({ onRetry }: ErrorNoticeProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // An error boundary swaps its children without moving focus, so the notice takes it to be announced.
  useEffect(() => heading.current?.focus(), []);

  return (
    <PageHeading title="Something went wrong on our side" headingRef={heading}>
      <p>This page did not load. Try again in a moment.</p>
      <Button type="button" variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </PageHeading>
  );
}
