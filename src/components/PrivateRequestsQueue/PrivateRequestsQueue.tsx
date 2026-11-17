import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { opsRequestsCopy } from '@/lib/copy/opsRequests';
import { opsRequestsPath, type OpsRequestRow } from '@/lib/opsRequests';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './PrivateRequestsQueue.module.css';

export type PrivateRequestsQueueProps = {
  rows: readonly OpsRequestRow[];
  query: TableQuery;
  cursor: string | null;
  nextCursor: string | null;
};

const { columns: heads } = opsRequestsCopy;

const columns: DataTableColumn<OpsRequestRow>[] = [
  {
    id: 'received',
    header: heads.received,
    rowHeader: true,
    cell: (row) => row.receivedLabel,
  },
  {
    id: 'experience',
    header: heads.experience,
    cell: (row) => row.experienceName,
  },
  {
    id: 'requestedDate',
    header: heads.requestedDate,
    cell: (row) => row.requestedLabel,
  },
  { id: 'groupSize', header: heads.groupSize, cell: (row) => row.groupLabel },
  {
    id: 'budget',
    header: heads.budget,
    align: 'end',
    cell: (row) => row.budgetLabel,
  },
  {
    id: 'from',
    header: heads.from,
    cell: (row) => (
      <span className={styles.stacked}>
        {row.name}
        <span className={styles.muted}>{row.email}</span>
      </span>
    ),
  },
  {
    id: 'message',
    header: heads.message,
    cell: (row) => {
      if (row.message === null) {
        return (
          <span className={styles.muted}>{opsRequestsCopy.noMessage}</span>
        );
      }
      if (row.message.full === null) return row.message.preview;
      return (
        <details className={styles.message}>
          <summary>{row.message.preview}</summary>
          <p className={styles.full}>{row.message.full}</p>
        </details>
      );
    },
  },
];

/** Newest private requests first. Paging is by links, so it works with no script; the page only reads. */
export function PrivateRequestsQueue({
  rows,
  query,
  cursor,
  nextCursor,
}: PrivateRequestsQueueProps) {
  return (
    <DataTable
      caption={opsRequestsCopy.caption}
      columns={columns}
      rows={rows}
      rowId={(row) => row.id}
      path={opsRequestsPath}
      query={query}
      sort={{ column: 'received', direction: 'desc' }}
      cursor={cursor}
      nextCursor={nextCursor}
      empty={opsRequestsCopy.empty}
    />
  );
}
