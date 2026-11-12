import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { PageHeading } from '@/components/PageHeading';
import { StaffView } from '@/components/StaffAdmin';
import {
  hostStaffEmptyBody,
  hostStaffInviteHint,
  hostStaffNoticeCodes,
  hostStaffNotices,
  hostStaffPath,
} from '@/lib/hostStaff';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { signInHref } from '@/lib/signIn';
import { parseStaffInviteProblems } from '@/lib/staffAdmin';
import {
  inviteHostStaffAction,
  resendHostStaffLinkAction,
  revokeHostStaffAction,
} from '@/server/actions/hostStaff';
import { loadHostStaff } from '@/server/hostStaff';

export const metadata: Metadata = { title: 'Staff' };

/** Like every host page, it checks the caller itself: nobody signed in signs in, and anyone who does not own a host, host staff included, sees the area's not-found page. */
export default async function HostStaffPage({
  searchParams,
}: PageProps<'/host/staff'>) {
  const query = await searchParams;
  const result = await loadHostStaff();
  if (result.status === 'signed_out') redirect(signInHref(hostStaffPath));
  if (result.status === 'refused') notFound();
  return (
    <PageHeading title="Staff">
      <ActionNotice
        notice={noticeText(
          hostStaffNotices,
          parseNotice(query.notice, hostStaffNoticeCodes),
        )}
      />
      <StaffView
        rows={result.rows}
        query={query}
        path={hostStaffPath}
        managedRole="host_staff"
        inviteHint={hostStaffInviteHint}
        emptyBody={hostStaffEmptyBody}
        problems={parseStaffInviteProblems(query.fields)}
        actions={{
          invite: inviteHostStaffAction,
          resend: resendHostStaffLinkAction,
          revoke: revokeHostStaffAction,
        }}
      />
    </PageHeading>
  );
}
