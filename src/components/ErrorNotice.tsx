import { useEffect, useRef } from 'react';
import { Button } from '@/components/Button';
import { PageHeading } from '@/components/PageHeading';
import { commonCopy } from '@/lib/copy/common';

type ErrorNoticeProps = { onRetry: () => void };

export function ErrorNotice({ onRetry }: ErrorNoticeProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // An error boundary swaps its children without moving focus, so the notice takes it to be announced.
  useEffect(() => heading.current?.focus(), []);

  return (
    <PageHeading title={commonCopy.error.title} headingRef={heading}>
      <p>{commonCopy.error.body}</p>
      <Button type="button" variant="secondary" onClick={onRetry}>
        {commonCopy.actions.tryAgain}
      </Button>
    </PageHeading>
  );
}
