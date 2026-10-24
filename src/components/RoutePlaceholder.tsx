import { PageHeading } from '@/components/PageHeading';

type RoutePlaceholderProps = {
  name: string;
  covers: string;
  param?: string;
};

export function RoutePlaceholder({
  name,
  covers,
  param,
}: RoutePlaceholderProps) {
  return (
    <PageHeading title={name}>
      <p>Covers {covers}.</p>
      {param ? <p>Address value: {param}</p> : null}
    </PageHeading>
  );
}
