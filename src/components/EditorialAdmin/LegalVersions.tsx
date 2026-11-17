import Link from 'next/link';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import { legalDocPath, type LegalVersionRow } from '@/lib/editorialLegal';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './EditorialAdmin.module.css';

const copy = opsEditorialContentCopy.legal.versions;

export type LegalVersionsProps = {
  doc: string;
  rows: readonly LegalVersionRow[];
  query: TableQuery;
  /** Set when the read failed: the table gives way to a retry. */
  failed?: boolean;
};

const columns: DataTableColumn<LegalVersionRow>[] = [
  {
    id: 'version',
    header: copy.columns.version,
    rowHeader: true,
    cell: (row) =>
      row.editHref === null ? (
        copy.versionLabel(row.version)
      ) : (
        <Link href={row.editHref}>{copy.editLabel(row.version)}</Link>
      ),
  },
  { id: 'title', header: copy.columns.title, cell: (row) => row.title },
  {
    id: 'status',
    header: copy.columns.status,
    cell: (row) => (
      <StatusBadge tone={row.statusTone} label={row.statusLabel} />
    ),
  },
  {
    id: 'published',
    header: copy.columns.published,
    cell: (row) => row.publishedLabel,
  },
];

/** The versions of one document, newest first; a draft links to its editor and a published version is final. */
export function LegalVersions({
  doc,
  rows,
  query,
  failed = false,
}: LegalVersionsProps) {
  return (
    <div className={styles.stack}>
      <DataTable
        caption={copy.caption}
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={legalDocPath(doc)}
        query={query}
        sort={{ column: 'version', direction: 'desc' }}
        cursor={null}
        nextCursor={null}
        empty={copy.empty}
        error={
          failed
            ? {
                title: opsEditorialContentCopy.legal.failed,
                retryHref: legalDocPath(doc),
              }
            : null
        }
      />
    </div>
  );
}
