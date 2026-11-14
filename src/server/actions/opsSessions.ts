'use server';

import { redirect } from 'next/navigation';
import { errorKind } from '@/lib/errorKind';
import { noticeHref } from '@/lib/opsForm';
import {
  allocationNotice,
  cancelOutcomeNotice,
  opsSessionPath,
  opsSessionsPath,
  parseAllocationForm,
  parseCancelForm,
  parsePauseForm,
  pauseOutcomeHref,
  PauseIncompleteError,
  type PauseOutcome,
} from '@/lib/opsSessions';
import {
  cancelSessionAsOps,
  changeAllocationAsOps,
  pauseExperienceAndCancel,
} from '@/server/db/opsSessions';
import { logger } from '@/server/monitoring/logger';
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

export async function changeOpsAllocationAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(opsSessionsPath);
  const back = opsSessionPath(
    idOrLeave(formData, 'sessionId', opsSessionsPath),
  );
  const parsed = parseAllocationForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(back, 'invalid'));

  redirect(
    noticeHref(
      back,
      allocationNotice(await changeAllocationAsOps(caller, parsed.value)),
    ),
  );
}

export async function pauseOpsExperienceAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(opsSessionsPath);
  const back = opsSessionPath(
    idOrLeave(formData, 'sessionId', opsSessionsPath),
  );
  const parsed = parsePauseForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(back, 'invalid'));

  let outcome: PauseOutcome;
  try {
    outcome = await pauseExperienceAndCancel(caller, parsed.value);
  } catch (error) {
    // The one failure that is told to the person: the pause stopped part-way. Each cancellation
    // that ran committed or rolled back whole, so the page can say how far it got and offer the retry.
    if (!(error instanceof PauseIncompleteError)) throw error;
    logger.error('pausing an experience stopped part-way', {
      errorKind: errorKind(error.cause),
      cancelled: error.cancelled,
      total: error.total,
    });
    outcome = {
      status: 'incomplete',
      cancelled: error.cancelled,
      total: error.total,
    };
  }
  redirect(pauseOutcomeHref(back, outcome));
}
