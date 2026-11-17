'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { hostAccessFor, ownedHostId } from '@/lib/hostAccess';
import {
  hostCancelOutcomeCode,
  parseHostCancelForm,
} from '@/lib/hostCancelSession';
import { hostCancelPath, hostSessionsPath } from '@/lib/hostSessions';
import { noticeHref, parseIdField } from '@/lib/opsForm';
import { ForbiddenError, getCaller } from '@/server/auth/caller';
import { cancelSessionAsHost } from '@/server/db/hostCancelSession';

/**
 * Cancels the session the form names for the host the caller owns, and ends on the cancel page with
 * the notice the result names. The caller is the person the session cookie names and the host is
 * their own grant's, never a field of the form, so a session id posted from another host is
 * answered as one that is not there. Anyone who is not that host's owner is sent back to the page,
 * which shows them the sign-in or the not-found page. A form with no session id leaves for the week.
 */
export async function cancelHostSessionAction(
  formData: FormData,
): Promise<void> {
  const sessionId = parseIdField(formData.get('sessionId'));
  if (sessionId === null) redirect(hostSessionsPath);
  const back = hostCancelPath(sessionId);
  const parsed = parseHostCancelForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(back, hostCancelOutcomeCode('invalid')));

  const caller = await getCaller();
  const hostId = ownedHostId(hostAccessFor(caller));
  if (hostId === null) redirect(back);

  let notice: string;
  try {
    notice = hostCancelOutcomeCode(
      await cancelSessionAsHost(caller, hostId, parsed.value),
    );
  } catch (error) {
    if (error instanceof ForbiddenError) redirect(back);
    throw error;
  }
  revalidatePath(hostSessionsPath);
  redirect(noticeHref(back, notice));
}
