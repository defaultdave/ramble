import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PageHeading } from '@/components/PageHeading';
import type { AuditViewRow, StaffRow } from '@/lib/staffAdmin';
import { AuditView } from './AuditView';
import { StaffView } from './StaffView';

// One story per state of staff admin and the audit viewer, on a phone and a desktop.
const noop = () => undefined;
const actions = { invite: noop, resend: noop, revoke: noop };
const staff: StaffRow[] = [
  {
    userId: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    email: 'ops@ramble.example',
    role: 'ops',
  },
  {
    userId: '2b2e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    email: 'admin@ramble.example',
    role: 'admin',
  },
];
const auditRows: AuditViewRow[] = [
  {
    id: '7',
    time: '09:05:03 UTC',
    actor: 'user 1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    action: 'role.granted',
    subject: 'auth_user 2b2e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    details: 'role: ops',
  },
  {
    id: '8',
    time: '09:05:04 UTC',
    actor: 'system',
    action: 'staff.link_sent',
    subject: 'auth_user 2b2e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    details: '—',
  },
];

const meta = {
  title: 'Ops/StaffAdmin',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const staffPage = (rows: StaffRow[], emailProblem = false) => (
  <PageHeading title="Staff">
    <StaffView
      rows={rows}
      query={{}}
      emailProblem={emailProblem}
      actions={actions}
    />
  </PageHeading>
);

export const Staff: Story = { render: () => staffPage(staff) };
export const NoStaff: Story = { render: () => staffPage([]) };
export const InviteRefused: Story = { render: () => staffPage(staff, true) };

const auditPage = (
  rows: AuditViewRow[],
  nextCursor: string | null,
  cursor: string | null = null,
) => (
  <PageHeading title="Audit log">
    <AuditView
      day="2026-11-11"
      rows={rows}
      query={{ day: '2026-11-11' }}
      cursor={cursor}
      nextCursor={nextCursor}
    />
  </PageHeading>
);

export const Audit: Story = { render: () => auditPage(auditRows, null) };
export const AuditNextPage: Story = {
  render: () => auditPage(auditRows, '8'),
};
export const AuditEmptyDay: Story = { render: () => auditPage([], null) };
