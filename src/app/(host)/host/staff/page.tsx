import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { HostStaff } from '@/components/HostStaff';
import { PageHeading } from '@/components/PageHeading';
import { hostStaffPath } from '@/lib/hostStaff';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { signInHref } from '@/lib/signIn';
import {
  parseStaffInviteProblems,
  staffNoticeCodes,
  staffNotices,
} from '@/lib/staffAdmin';
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
          staffNotices,
          parseNotice(query.notice, staffNoticeCodes),
        )}
      />
      <HostStaff
        rows={result.rows}
        query={query}
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
