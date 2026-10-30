import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { PageHeading } from '@/components/PageHeading';

export type PageErrorProps = {
  /** The page's h1, kept so the page still has a heading when its content failed. */
  title: string;
  alertTitle: string;
  alertBody: string;
  /** The page's own address, which Try again reloads. */
  retryHref: string;
};

/**
 * The error state of a whole page: the page keeps its heading and says what happened. Try again is
 * a GET form to the same address, so it works with no script and reloads exactly what failed.
 */
export function PageError({
  title,
  alertTitle,
  alertBody,
  retryHref,
}: PageErrorProps) {
  return (
    <PageHeading title={title}>
      <Alert tone="danger" title={alertTitle} body={alertBody} />
      <form action={retryHref} method="get">
        <Button type="submit" variant="secondary">
          Try again
        </Button>
      </form>
    </PageHeading>
  );
}
