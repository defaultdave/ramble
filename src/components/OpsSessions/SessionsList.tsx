import Link from 'next/link';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { SearchField } from '@/components/SearchField';
import { StatusBadge, StatusFilterBar } from '@/components/StatusBadge';
import {
  opsSessionsPath,
  sessionWhenOptions,
  type OpsSessionRow,
} from '@/lib/opsSessions';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './OpsSessions.module.css';

const columns: DataTableColumn<OpsSessionRow>[] = [
  {
    id: 'when',
    header: 'When',
    rowHeader: true,
    cell: (row) => (
      <Link className={styles.cellLink} href={row.href}>
        {row.whenLabel}
      </Link>
    ),
  },
  { id: 'experience', header: 'Experience', cell: (row) => row.experienceName },
  { id: 'host', header: 'Host', cell: (row) => row.hostName },
  {
    id: 'sold',
    header: 'Sold',
    align: 'end',
    cell: (row) => <span className={styles.number}>{row.sold}</span>,
  },
  {
    id: 'held',
    header: 'Held',
    align: 'end',
    cell: (row) => <span className={styles.number}>{row.held}</span>,
  },
  {
    id: 'capacity',
    header: 'Capacity',
    align: 'end',
    cell: (row) => <span className={styles.number}>{row.capacity}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <StatusBadge tone={row.statusTone} label={row.statusLabel} />
    ),
  },
];

export type SessionsListProps = {
  rows: readonly OpsSessionRow[];
  query: TableQuery;
  term: string;
  /** The order the rows run in, as the page's read chose it. */
  direction: 'asc' | 'desc';
  cursor: string | null;
  nextCursor: string | null;
};

/** Sessions by start time, filtered by upcoming or past and searched by experience or host. Every filter and page is an address, so it works with no script. */
export function SessionsList({
  rows,
  query,
  term,
  direction,
  cursor,
  nextCursor,
}: SessionsListProps) {
  return (
    <div className={styles.stack}>
      <div className={styles.filters}>
        <StatusFilterBar
          path={opsSessionsPath}
          query={query}
          options={sessionWhenOptions}
          label="Filter sessions by when they start"
        />
        <SearchField
          path={opsSessionsPath}
          query={query}
          value={term}
          label="Search by experience or host"
        />
      </div>
      <DataTable
        caption="Sessions"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={opsSessionsPath}
        query={query}
        sort={{ column: 'when', direction }}
        cursor={cursor}
        nextCursor={nextCursor}
        empty={{
          title: 'No sessions match',
          body: 'Change the filter or the search.',
        }}
      />
    </div>
  );
}
