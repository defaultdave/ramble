import { Button } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { Input } from '@/components/Input';
import { auditPath, type AuditViewRow } from '@/lib/staffAdmin';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './StaffAdmin.module.css';

const columns: DataTableColumn<AuditViewRow>[] = [
  { id: 'time', header: 'Time', rowHeader: true, cell: (row) => row.time },
  { id: 'actor', header: 'Actor', cell: (row) => row.actor },
  { id: 'action', header: 'Action', cell: (row) => row.action },
  { id: 'subject', header: 'Subject', cell: (row) => row.subject },
  {
    id: 'details',
    header: 'Details',
    cell: (row) => <span className={styles.details}>{row.details}</span>,
  },
];

export type AuditViewProps = {
  day: string;
  rows: readonly AuditViewRow[];
  query: TableQuery;
  cursor: string | null;
  nextCursor: string | null;
};

/** One UTC day of the audit log, oldest first. The day is chosen with a plain form, so it works with no script. */
export function AuditView({
  day,
  rows,
  query,
  cursor,
  nextCursor,
}: AuditViewProps) {
  return (
    <div className={styles.stack}>
      <form method="get" action={auditPath} className={styles.form}>
        <Input name="day" type="date" label="Day (UTC)" defaultValue={day} />
        <Button type="submit" variant="secondary">
          Show this day
        </Button>
      </form>
      <DataTable
        caption={`Audit log for ${day}`}
        columns={columns}
        rows={rows}
        rowId={(row) => row.id}
        path={auditPath}
        query={query}
        sort={{ column: 'time', direction: 'asc' }}
        cursor={cursor}
        nextCursor={nextCursor}
        empty={{ title: 'Nothing was recorded on this day' }}
      />
    </div>
  );
}
