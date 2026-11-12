'use server';

import { redirect } from 'next/navigation';
import { hostAccessFor } from '@/lib/hostAccess';
import { hostStaffPath } from '@/lib/hostStaff';
import { noticeHref, parseIdField } from '@/lib/opsForm';
import {
  parseStaffEmail,
  revokeNotice,
  staffInviteField,
  staffInviteNotice,
} from '@/lib/staffAdmin';
import { getCaller } from '@/server/auth/caller';
import { revokeHostStaff } from '@/server/db/staffRoles';
import { inviteHostStaff, resendHostStaffLink } from '@/server/hostStaffInvite';

/** The caller and the host they own. Anyone else, host staff included, is sent to the host's home before anything is read or changed. */
async function ownerOrLeave() {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  if (access.kind !== 'owner') redirect('/host');
  return { caller, hostId: access.hostId };
}

function userIdOrLeave(formData: FormData): string {
  const userId = parseIdField(formData.get('userId'));
  if (userId === null) redirect(hostStaffPath);
  return userId;
}

export async function inviteHostStaffAction(formData: FormData): Promise<void> {
  const { caller, hostId } = await ownerOrLeave();
  const email = parseStaffEmail((name) => formData.get(name));
  if (email === null) {
    redirect(noticeHref(hostStaffPath, 'invalid', [staffInviteField]));
  }
  const result = await inviteHostStaff(caller, hostId, email);
  redirect(noticeHref(hostStaffPath, staffInviteNotice(result, true)));
}

export async function resendHostStaffLinkAction(
  formData: FormData,
): Promise<void> {
  const { caller, hostId } = await ownerOrLeave();
  const userId = userIdOrLeave(formData);
  const result = await resendHostStaffLink(caller, hostId, userId);
  redirect(noticeHref(hostStaffPath, staffInviteNotice(result, false)));
}

export async function revokeHostStaffAction(formData: FormData): Promise<void> {
  const { caller, hostId } = await ownerOrLeave();
  const userId = userIdOrLeave(formData);
  const outcome = await revokeHostStaff(caller, hostId, userId);
  redirect(noticeHref(hostStaffPath, revokeNotice(outcome)));
}
