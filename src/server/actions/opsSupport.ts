'use server';

import { redirect } from 'next/navigation';
import { noticeHref } from '@/lib/opsForm';
import { parseSupportResolveForm, supportQueuePath } from '@/lib/supportQueue';
import { resolveSupportRequest } from '@/server/db/supportQueue';
import { opsCallerOrLeave } from '@/server/opsAccess';

export async function resolveSupportRequestAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(supportQueuePath);
  const parsed = parseSupportResolveForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(supportQueuePath, 'invalid'));

  const outcome = await resolveSupportRequest(caller, parsed.value);
  redirect(noticeHref(supportQueuePath, outcome));
}
