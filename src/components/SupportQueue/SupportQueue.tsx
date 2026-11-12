import { Button } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { Input } from '@/components/Input';
import { StatusBadge, StatusFilterBar } from '@/components/StatusBadge';
import { supportLimits } from '@/lib/support';
import {
  supportStatusLabels,
  supportStatusOptions,
  supportStatusTones,
  supportQueuePath,
  type SupportQueueRow,
} from '@/lib/supportQueue';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './SupportQueue.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type SupportQueueProps = {
  rows: readonly SupportQueueRow[];
  query: TableQuery;
  cursor: string | null;
  nextCursor: string | null;
  resolve: FormAction;
};

/** Newest requests first, filtered by status. Filters and pages are links and the resolve form is a plain form, so it all works with no script. */
export function SupportQueue({
  rows,
  query,
  cursor,
  nextCursor,
  resolve,
}: SupportQueueProps) {
  const columns: DataTableColumn<SupportQueueRow>[] = [
    {
      id: 'received',
      header: 'Received',
      rowHeader: true,
      cell: (row) => row.receivedLabel,
    },
    {
      id: 'from',
      header: 'From',
      cell: (row) => (
        <span className={styles.stacked}>
          {row.name}
          <span className={styles.muted}>{row.email}</span>
        </span>
      ),
    },
    { id: 'reason', header: 'Reason', cell: (row) => row.reason },
    {
      id: 'message',
      header: 'Message',
      cell: (row) => <span className={styles.message}>{row.message}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <StatusBadge
          tone={supportStatusTones[row.status]}
          label={supportStatusLabels[row.status]}
        />
      ),
    },
    {
      id: 'resolve',
      header: 'Resolution',
      cell: (row) =>
        row.resolution ? (
          <span className={styles.stacked}>
            {row.resolution.note}
            <span className={styles.muted}>{row.resolution.whenLabel}</span>
          </span>
        ) : (
          <form action={resolve} className={styles.resolveForm}>
            <input type="hidden" name="id" value={row.id} />
            <Input
              name="note"
              label={`Note for ${row.name}`}
              maxLength={supportLimits.resolutionNoteMaxChars}
              autoComplete="off"
              required
            />
            <Button type="submit" variant="secondary">
              Mark resolved
            </Button>
          </form>
        ),
    },
  ];

  return (
    <div className={styles.stack}>
      <StatusFilterBar
        path={supportQueuePath}
        query={query}
        options={supportStatusOptions}
        label="Filter requests by status"
      />
      <DataTable
        caption="Support requests"
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={supportQueuePath}
        query={query}
        sort={{ column: 'received', direction: 'desc' }}
        cursor={cursor}
        nextCursor={nextCursor}
        empty={{
          title: 'No support requests',
          body: 'Messages sent through the contact form appear here.',
        }}
      />
    </div>
  );
}
