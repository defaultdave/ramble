'use server';

import { redirect } from 'next/navigation';
import { noticeHref } from '@/lib/opsForm';
import {
  parseStaffEmail,
  revokeNotice,
  staffGrant,
  staffInviteField,
  staffInviteNotice,
  staffPath,
} from '@/lib/staffAdmin';
import { revokeRole } from '@/server/db/staffRoles';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';
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
  const userId = idOrLeave(formData, 'userId', staffPath);
  redirect(
    noticeHref(
      staffPath,
      staffInviteNotice(await resendStaffLink(caller, userId), false),
    ),
  );
}

export async function revokeStaffAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(staffPath);
  const userId = idOrLeave(formData, 'userId', staffPath);
  const outcome = await revokeRole(caller, userId, staffGrant);
  redirect(noticeHref(staffPath, revokeNotice(outcome)));
}
