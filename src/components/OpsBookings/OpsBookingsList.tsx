import Link from 'next/link';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { SearchField } from '@/components/SearchField';
import { StatusBadge, StatusFilterBar } from '@/components/StatusBadge';
import {
  bookingFilterOptions,
  opsBookingsPath,
  orderStatusLabels,
  orderStatusTones,
  type OpsBookingRow,
} from '@/lib/opsBookings';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './OpsBookings.module.css';

export type OpsBookingsListProps = {
  rows: readonly OpsBookingRow[];
  query: TableQuery;
  /** The search term now, as `parseSearchTerm` read it. */
  term: string;
  /** What the list says under the search box; empty for none. */
  summary: string;
  cursor: string | null;
  nextCursor: string | null;
};

/** Bookings newest first, found by reference or guest email, with the refund-failed queue as a filter. Search, filter, and paging are links and a GET form, so it all works with no script. */
export function OpsBookingsList({
  rows,
  query,
  term,
  summary,
  cursor,
  nextCursor,
}: OpsBookingsListProps) {
  const columns: DataTableColumn<OpsBookingRow>[] = [
    {
      id: 'reference',
      header: 'Booking',
      rowHeader: true,
      cell: (row) => (
        <Link className={styles.cellLink} href={row.href}>
          {row.reference}
        </Link>
      ),
    },
    {
      id: 'guest',
      header: 'Guest',
      cell: (row) => (
        <span className={styles.stacked}>
          {row.guestName}
          <span className={styles.muted}>{row.email}</span>
        </span>
      ),
    },
    {
      id: 'experience',
      header: 'Experience',
      cell: (row) => (
        <span className={styles.stacked}>
          {row.experienceName}
          <span className={styles.muted}>{row.whenLabel}</span>
        </span>
      ),
    },
    {
      id: 'total',
      header: 'Total',
      align: 'end',
      cell: (row) => row.totalLabel,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <span className={styles.stacked}>
          <StatusBadge
            tone={orderStatusTones[row.status]}
            label={orderStatusLabels[row.status]}
          />
          {row.refundFailed ? (
            <StatusBadge tone="danger" label="Refund failed" />
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className={styles.stack}>
      <SearchField
        path={opsBookingsPath}
        query={query}
        value={term}
        label="Search bookings"
        placeholder="Booking reference or guest email"
      />
      {summary === '' ? null : (
        <p className={styles.muted} role="status">
          {summary}
        </p>
      )}
      <StatusFilterBar
        path={opsBookingsPath}
        query={query}
        options={bookingFilterOptions}
        label="Filter bookings"
      />
      <DataTable
        caption="Bookings"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={opsBookingsPath}
        query={query}
        sort={{ column: 'created', direction: 'desc' }}
        cursor={cursor}
        nextCursor={nextCursor}
        empty={{
          title: 'No bookings',
          body: 'Search by booking reference or guest email, or clear the filter.',
        }}
      />
    </div>
  );
}
