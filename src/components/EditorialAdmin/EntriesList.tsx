import Link from 'next/link';
import { ButtonLink } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import {
  editorialPath,
  entryPath,
  entryStatusLabels,
  entryStatusTones,
  newEntryPath,
  type EntryRow,
} from '@/lib/editorialAdmin';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './EditorialAdmin.module.css';

export type EntriesListProps = {
  rows: readonly EntryRow[];
  query: TableQuery;
  /** Set when the read failed: the table gives way to a retry. */
  failed?: boolean;
};

const columns: DataTableColumn<EntryRow>[] = [
  {
    id: 'title',
    header: 'Title',
    rowHeader: true,
    cell: (row) => <Link href={entryPath(row.id)}>{row.title}</Link>,
  },
  { id: 'slug', header: 'Address', cell: (row) => row.slug },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <StatusBadge
        tone={entryStatusTones[row.status]}
        label={entryStatusLabels[row.status]}
      />
    ),
  },
  { id: 'updated', header: 'Updated', cell: (row) => row.updatedLabel },
];

/** Every help article, drafts and published, in the order guests see them. */
export function EntriesList({ rows, query, failed = false }: EntriesListProps) {
  return (
    <div className={styles.stack}>
      <p>
        <ButtonLink href={newEntryPath}>New article</ButtonLink>
      </p>
      <DataTable
        caption="Help articles"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={editorialPath}
        query={query}
        sort={{ column: 'title', direction: 'asc' }}
        cursor={null}
        nextCursor={null}
        empty={{
          title: 'No articles yet',
          body: 'Write the first one: a draft stays hidden until you publish it.',
        }}
        error={
          failed
            ? {
                title: 'The articles could not be loaded.',
                retryHref: editorialPath,
              }
            : null
        }
      />
    </div>
  );
}
