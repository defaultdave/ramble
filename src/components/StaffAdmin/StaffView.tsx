import { Button } from '@/components/Button';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmailField } from '@/components/EmailField';
import { errorProps } from '@/lib/opsForm';
import type { GrantableRole } from '@/lib/roleGrants';
import {
  isManagedStaffRow,
  staffGrant,
  staffInviteField,
  staffInviteProblems,
  staffPath,
  staffRolesText,
  type StaffInviteField,
  type StaffRow,
} from '@/lib/staffAdmin';
import type { TableQuery } from '@/lib/tableQuery';
import styles from './StaffAdmin.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type StaffViewProps = {
  rows: readonly StaffRow[];
  query: TableQuery;
  /** The invite form's address was refused on the last try. */
  problems: readonly StaffInviteField[];
  /** The page the table links back to; the ops staff page by default. */
  path?: string;
  /** The role the row buttons manage; other roles in the table are listed without them. */
  managedRole?: GrantableRole;
  inviteHint?: string;
  emptyBody?: string;
  actions: { invite: FormAction; resend: FormAction; revoke: FormAction };
};

function StaffActions({
  row,
  managedRole,
  actions,
}: {
  row: StaffRow;
  managedRole: GrantableRole;
  actions: StaffViewProps['actions'];
}) {
  // Only the managed role is acted on here; ops staff admin leaves admin to the command line.
  if (!isManagedStaffRow(row, managedRole)) return null;
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
export function StaffView({
  rows,
  query,
  problems,
  path = staffPath,
  managedRole = staffGrant.role,
  inviteHint = 'Gives the ops role and emails a single-use sign-in link.',
  emptyBody = 'Invite the first staff member above.',
  actions,
}: StaffViewProps) {
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
      cell: (row) => (
        <StaffActions row={row} managedRole={managedRole} actions={actions} />
      ),
    },
  ];
  return (
    <div className={styles.stack}>
      <form action={actions.invite} className={styles.form} noValidate>
        <EmailField
          name={staffInviteField}
          label="Email address"
          hint={inviteHint}
          {...errorProps(problems, staffInviteProblems, staffInviteField)}
        />
        <Button type="submit">Invite staff member</Button>
      </form>
      <DataTable
        caption="Staff"
        columns={columns}
        rows={rows}
        rowId={(row) => row.userId}
        path={path}
        query={query}
        sort={{ column: 'email', direction: 'asc' }}
        cursor={null}
        nextCursor={null}
        empty={{
          title: 'No staff yet',
          body: emptyBody,
        }}
      />
    </div>
  );
}
