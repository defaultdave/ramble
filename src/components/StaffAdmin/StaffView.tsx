import { Button } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmailField } from '@/components/EmailField';
import {
  isManagedStaffRow,
  staffInviteProblems,
  staffRolesText,
  staffInviteField,
  type StaffInviteField,
  staffPath,
  type StaffRow,
} from '@/lib/staffAdmin';
import { errorProps } from '@/lib/opsForm';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './StaffAdmin.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type StaffViewProps = {
  rows: readonly StaffRow[];
  query: TableQuery;
  /** The invite form's address was refused on the last try. */
  problems: readonly StaffInviteField[];
  actions: { invite: FormAction; resend: FormAction; revoke: FormAction };
};

function StaffActions({
  row,
  actions,
}: {
  row: StaffRow;
  actions: StaffViewProps['actions'];
}) {
  // Only the ops role is managed here; admin is granted and removed from the command line.
  if (!isManagedStaffRow(row)) return null;
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

/** The ops staff: an invite form on top, then who holds ops or admin, with the link and removal buttons. */
export function StaffView({ rows, query, problems, actions }: StaffViewProps) {
  const columns: DataTableColumn<StaffRow>[] = [
    {
      id: 'email',
      header: 'Staff member',
      rowHeader: true,
      cell: (row) => row.email,
    },
    {
      id: 'role',
      header: 'Role',
      cell: (row) => staffRolesText(row.roles),
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
          hint="Gives the ops role and emails a single-use sign-in link."
          {...errorProps(problems, staffInviteProblems, staffInviteField)}
        />
        <Button type="submit">Invite staff member</Button>
      </form>
      <DataTable
        caption="Staff"
        columns={columns}
        rows={rows}
        rowId={(row) => row.userId}
        path={staffPath}
        query={query}
        sort={{ column: 'email', direction: 'asc' }}
        cursor={null}
        nextCursor={null}
        empty={{
          title: 'No staff yet',
          body: 'Invite the first staff member above.',
        }}
      />
    </div>
  );
}
