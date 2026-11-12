'use server';

import { redirect } from 'next/navigation';
import { noticeHref, parseIdField } from '@/lib/opsForm';
import {
  invitedRole,
  parseStaffEmail,
  revokeNotice,
  staffInviteField,
  staffInviteNotice,
  staffPath,
} from '@/lib/staffAdmin';
import { revokeRole } from '@/server/db/staffRoles';
import { opsCallerOrLeave } from '@/server/opsAccess';
import { inviteStaff, resendStaffLink } from '@/server/staffInvite';

export async function inviteStaffAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(staffPath);
  const email = parseStaffEmail((name) => formData.get(name));
  if (email === null) {
    redirect(noticeHref(staffPath, 'invalid', [staffInviteField]));
  }
  redirect(
    noticeHref(
      staffPath,
      staffInviteNotice(await inviteStaff(caller, email), true),
    ),
  );
}

export async function resendStaffLinkAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(staffPath);
  const userId = parseIdField(formData.get('userId'));
  if (userId === null) redirect(staffPath);
  redirect(
    noticeHref(
      staffPath,
      staffInviteNotice(await resendStaffLink(caller, userId), false),
    ),
  );
}

export async function revokeStaffAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(staffPath);
  const userId = parseIdField(formData.get('userId'));
  if (userId === null) redirect(staffPath);
  const outcome = await revokeRole(caller, userId, {
    role: invitedRole,
    hostId: null,
  });
  redirect(noticeHref(staffPath, revokeNotice(outcome)));
}
