import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { StaffView } from '@/components/StaffAdmin';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  hasStaffInviteProblem,
  staffNoticeCodes,
  staffNotices,
  staffPath,
} from '@/lib/staffAdmin';
import {
  inviteStaffAction,
  resendStaffLinkAction,
  revokeStaffAction,
} from '@/server/actions/opsStaff';
import { readStaffForOps } from '@/server/db/staffRoles';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Staff' };

export default async function StaffPage({
  searchParams,
}: PageProps<'/ops/staff'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) return <OpsAccessDenied next={staffPath} />;

  const rows = await readStaffForOps(caller);
  return (
    <PageHeading title="Staff">
      <ActionNotice
        notice={noticeText(
          staffNotices,
          parseNotice(query.notice, staffNoticeCodes),
        )}
      />
      <StaffView
        rows={rows}
        query={query}
        emailProblem={hasStaffInviteProblem(query.fields)}
        actions={{
          invite: inviteStaffAction,
          resend: resendStaffLinkAction,
          revoke: revokeStaffAction,
        }}
      />
    </PageHeading>
  );
}
