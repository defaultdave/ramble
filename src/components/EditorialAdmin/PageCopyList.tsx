import Link from 'next/link';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import { pagesPath, type PageKind, type PageRow } from '@/lib/editorialPages';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialContentCopy.pages;

export type PageCopyListProps = {
  categories: readonly PageRow[];
  neighborhoods: readonly PageRow[];
  query: TableQuery;
  /** Set when the read failed: the tables give way to a retry. */
  failed?: boolean;
};

const columns: DataTableColumn<PageRow>[] = [
  {
    id: 'name',
    header: copy.columns.name,
    rowHeader: true,
    cell: (row) => <Link href={row.href}>{row.name}</Link>,
  },
  { id: 'slug', header: copy.columns.slug, cell: (row) => row.slug },
  {
    id: 'copy',
    header: copy.columns.copy,
    cell: (row) => (
      <>
        <StatusBadge tone={row.statusTone} label={row.statusLabel} />
        {row.retired ? ` ${copy.states.retired}` : null}
      </>
    ),
  },
  {
    id: 'updated',
    header: copy.columns.updated,
    cell: (row) => row.updatedLabel,
  },
];

/** Every category and neighborhood with the status of its page copy: one table per kind, each name opening its copy. */
export function PageCopyList({
  categories,
  neighborhoods,
  query,
  failed = false,
}: PageCopyListProps) {
  const table = (kind: PageKind, rows: readonly PageRow[]) => (
    <DataTable
      caption={copy.captions[kind]}
      columns={columns}
      rows={rows}
      rowId={(row) => row.id}
      path={pagesPath}
      query={query}
      sort={{ column: 'name', direction: 'asc' }}
      cursor={null}
      nextCursor={null}
      empty={copy.empty}
      error={failed ? { title: copy.failed, retryHref: pagesPath } : null}
    />
  );
  return (
    <div className={styles.stack}>
      {table('category', categories)}
      {table('neighborhood', neighborhoods)}
    </div>
  );
}
