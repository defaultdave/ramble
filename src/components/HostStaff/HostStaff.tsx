import { Button } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmailField } from '@/components/EmailField';
import { hostStaffPath, type HostStaffRow } from '@/lib/hostStaff';
import { errorProps } from '@/lib/opsForm';
import {
  staffInviteField,
  staffInviteProblems,
  type StaffInviteField,
} from '@/lib/staffAdmin';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './HostStaff.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type HostStaffProps = {
  rows: readonly HostStaffRow[];
  query: TableQuery;
  /** The invite form's address was refused on the last try. */
  problems: readonly StaffInviteField[];
  actions: { invite: FormAction; resend: FormAction; revoke: FormAction };
};

function StaffActions({
  row,
  actions,
}: {
  row: HostStaffRow;
  actions: HostStaffProps['actions'];
}) {
  return (
    <div className={styles.actions}>
      <form action={actions.resend}>
        <input type="hidden" name="userId" value={row.userId} />
        <Button type="submit" variant="secondary">
          Send a sign-in link
        </Button>
      </form>
      <form action={actions.revoke}>
        <input type="hidden" name="userId" value={row.userId} />
        <Button type="submit" variant="secondary">
          Remove access
        </Button>
      </form>
    </div>
  );
}

/** The host's staff: an invite form, then who can read the host's dashboard, sessions and guest lists, with the link and removal buttons. */
export function HostStaff({ rows, query, problems, actions }: HostStaffProps) {
  const columns: DataTableColumn<HostStaffRow>[] = [
    {
      id: 'email',
      header: 'Staff member',
      rowHeader: true,
      cell: (row) => row.email,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (row) => <StaffActions row={row} actions={actions} />,
    },
  ];
  return (
    <div className={styles.stack}>
      <form action={actions.invite} className={styles.form} noValidate>
        <EmailField
          name={staffInviteField}
          label="Email address"
          hint="Staff can see your dashboard, sessions and guest lists, and change nothing. They get a single-use sign-in link."
          {...errorProps(problems, staffInviteProblems, staffInviteField)}
        />
        <Button type="submit">Invite staff member</Button>
      </form>
      <DataTable
        caption="Staff"
        columns={columns}
        rows={rows}
        rowId={(row) => row.userId}
        path={hostStaffPath}
        query={query}
        sort={{ column: 'email', direction: 'asc' }}
        cursor={null}
        nextCursor={null}
        empty={{
          title: 'No staff yet',
          body: 'Invite a staff member above.',
        }}
      />
    </div>
  );
}
