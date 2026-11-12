import Link from 'next/link';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import {
  acceptanceLabels,
  acceptanceTones,
  hostPath,
  hostsPath,
  ownerCellLabel,
  type HostListRow,
} from '@/lib/hostSetup';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './HostSetup.module.css';

const columns: DataTableColumn<HostListRow>[] = [
  {
    id: 'name',
    header: 'Host',
    rowHeader: true,
    cell: (row) => (
      <Link className={styles.cellLink} href={hostPath(row.id)}>
        {row.name}
      </Link>
    ),
  },
  {
    id: 'owners',
    header: 'Owner',
    cell: (row) => ownerCellLabel(row.ownerEmails),
  },
  {
    id: 'agreement',
    header: 'Agreement',
    cell: (row) => (
      <StatusBadge
        tone={acceptanceTones[row.acceptance]}
        label={acceptanceLabels[row.acceptance]}
      />
    ),
  },
  { id: 'timeZone', header: 'Time zone', cell: (row) => row.timeZone },
];

export type HostsTableProps = {
  rows: readonly HostListRow[];
  query: TableQuery;
  cursor: string | null;
  nextCursor: string | null;
};

/** The hosts, by name. Paging is by link, so it works with no script. */
export function HostsTable({
  rows,
  query,
  cursor,
  nextCursor,
}: HostsTableProps) {
  return (
    <DataTable
      caption="Hosts"
      columns={columns}
      rows={rows}
      rowId={(row) => row.id}
      path={hostsPath}
      query={query}
      sort={{ column: 'name', direction: 'asc' }}
      cursor={cursor}
      nextCursor={nextCursor}
      empty={{
        title: 'No hosts yet',
        body: 'Add the first host to set up its owner and agreement.',
      }}
    />
  );
}
