import { DataTable } from '@/components/DataTable';
import { experienceColumns } from '@/components/ExperienceEditor';
import type { ExperienceListRow } from '@/lib/experienceEditor';
import { reviewItemPath, reviewPath } from '@/lib/experienceReview';
import type { TableQuery } from '@/lib/tableQuery';

const columns = experienceColumns(reviewItemPath, false);

export type ReviewQueueProps = {
  rows: readonly ExperienceListRow[];
  query: TableQuery;
  cursor: string | null;
  nextCursor: string | null;
};

/** The experiences waiting for review by name, each linking to its review page. Every page is an address, so the queue works with no script. */
export function ReviewQueue({
  rows,
  query,
  cursor,
  nextCursor,
}: ReviewQueueProps) {
  return (
    <DataTable
      caption="Experiences waiting for review"
      columns={columns}
      rows={rows}
      rowId={(row) => row.id}
      path={reviewPath}
      query={query}
      sort={{ column: 'name', direction: 'asc' }}
      cursor={cursor}
      nextCursor={nextCursor}
      empty={{
        title: 'Nothing is waiting for review',
        body: 'An experience a host puts forward for review appears here.',
      }}
    />
  );
}
