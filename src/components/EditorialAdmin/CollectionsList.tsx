import Link from 'next/link';
import { ButtonLink } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import {
  collectionPath,
  collectionStatusLabels,
  collectionStatusTones,
  collectionsPath,
  newCollectionPath,
  type CollectionRow,
} from '@/lib/editorialCollections';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialSectionsCopy.collections;

export type CollectionsListProps = {
  rows: readonly CollectionRow[];
  query: TableQuery;
  /** Set when the read failed: the table gives way to a retry. */
  failed?: boolean;
};

const columns: DataTableColumn<CollectionRow>[] = [
  {
    id: 'title',
    header: copy.columns.title,
    rowHeader: true,
    cell: (row) => <Link href={collectionPath(row.id)}>{row.title}</Link>,
  },
  { id: 'slug', header: copy.columns.slug, cell: (row) => row.slug },
  {
    id: 'entries',
    header: copy.columns.entries,
    align: 'end',
    cell: (row) => row.entryCount,
  },
  {
    id: 'status',
    header: copy.columns.status,
    cell: (row) => (
      <StatusBadge
        tone={collectionStatusTones[row.status]}
        label={collectionStatusLabels[row.status]}
      />
    ),
  },
  {
    id: 'updated',
    header: copy.columns.updated,
    cell: (row) => row.updatedLabel,
  },
];

/** Every Ramble Pick, drafts and published, by title. */
export function CollectionsList({
  rows,
  query,
  failed = false,
}: CollectionsListProps) {
  return (
    <div className={styles.stack}>
      <p>
        <ButtonLink href={newCollectionPath}>{copy.newLink}</ButtonLink>
      </p>
      <DataTable
        caption={copy.caption}
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={collectionsPath}
        query={query}
        sort={{ column: 'title', direction: 'asc' }}
        cursor={null}
        nextCursor={null}
        empty={copy.empty}
        error={
          failed ? { title: copy.failed, retryHref: collectionsPath } : null
        }
      />
    </div>
  );
}
