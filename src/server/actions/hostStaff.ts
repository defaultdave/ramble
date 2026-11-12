'use server';

import { redirect } from 'next/navigation';
import { hostInviteNotice, hostStaffPath } from '@/lib/hostStaff';
import { noticeHref } from '@/lib/opsForm';
import {
  parseStaffEmail,
  revokeNotice,
  staffInviteField,
} from '@/lib/staffAdmin';
import { revokeHostStaff } from '@/server/db/staffRoles';
import { ownerOrLeave } from '@/server/hostStaff';
import { inviteHostStaff, resendHostStaffLink } from '@/server/hostStaffInvite';
import { idOrLeave } from '@/server/opsAccess';

const hostHome = '/host';

export async function inviteHostStaffAction(formData: FormData): Promise<void> {
  const { caller, hostId } = await ownerOrLeave(hostHome);
  const email = parseStaffEmail((name) => formData.get(name));
  if (email === null) {
    redirect(noticeHref(hostStaffPath, 'invalid', [staffInviteField]));
  }
  const result = await inviteHostStaff(caller, hostId, email);
  redirect(noticeHref(hostStaffPath, hostInviteNotice(result, true)));
}

export async function resendHostStaffLinkAction(
  formData: FormData,
): Promise<void> {
  const { caller, hostId } = await ownerOrLeave(hostHome);
  const userId = idOrLeave(formData, 'userId', hostStaffPath);
  const result = await resendHostStaffLink(caller, hostId, userId);
  redirect(noticeHref(hostStaffPath, hostInviteNotice(result, false)));
}

export async function revokeHostStaffAction(formData: FormData): Promise<void> {
  const { caller, hostId } = await ownerOrLeave(hostHome);
  const userId = idOrLeave(formData, 'userId', hostStaffPath);
  const outcome = await revokeHostStaff(caller, hostId, userId);
  redirect(noticeHref(hostStaffPath, revokeNotice(outcome)));
}
