'use server';

import { redirect } from 'next/navigation';
import { noticeHref } from '@/lib/opsForm';
import {
  cancelOutcomeNotice,
  opsSessionPath,
  opsSessionsPath,
  parseCancelForm,
} from '@/lib/opsSessions';
import { cancelSessionAsOps } from '@/server/db/opsSessions';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';

// Each action checks the ops role first, then reads its form, and ends on the session's page with
// the notice its result names. A form that carries no session id leaves for the list.

export async function cancelOpsSessionAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(opsSessionsPath);
  const back = opsSessionPath(
    idOrLeave(formData, 'sessionId', opsSessionsPath),
  );
  const parsed = parseCancelForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(back, 'invalid'));

  redirect(
    noticeHref(
      back,
      cancelOutcomeNotice(await cancelSessionAsOps(caller, parsed.value)),
    ),
  );
}
