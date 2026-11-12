'use server';

import { redirect } from 'next/navigation';
import {
  experiencePath,
  experiencesPath,
  newExperiencePath,
  parseExperienceCreateForm,
  parseExperienceEditForm,
} from '@/lib/experienceEditor';
import { noticeHref, parseIdField } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import type { Caller } from '@/server/auth/caller';
import {
  createExperience,
  updateExperience,
} from '@/server/db/experienceEditor';
import { readOpsCaller } from '@/server/opsCaller';

// Each action sends the person on with `redirect`, which works by throwing, so none is wrapped in
// a try. The ops list page shows the refusal to anyone without the role, so that is where a
// caller without it is sent, and nothing about the request is said.
async function opsCallerOrLeave(): Promise<Caller> {
  const caller = await readOpsCaller();
  if (!holdsOpsRole(caller.roles)) redirect(experiencesPath);
  return caller;
}

export async function createExperienceAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave();
  const parsed = parseExperienceCreateForm((name) => formData.get(name));
  if (!parsed.ok) {
    redirect(noticeHref(newExperiencePath, 'invalid', parsed.fields));
  }
  const created = await createExperience(caller, parsed.value);
  if (created.status === 'reference_missing') {
    redirect(noticeHref(newExperiencePath, 'reference_missing'));
  }
  redirect(noticeHref(experiencePath(created.experienceId), 'created'));
}

export async function updateExperienceAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave();
  const experienceId = parseIdField(formData.get('experienceId'));
  if (experienceId === null) redirect(experiencesPath);
  const here = experiencePath(experienceId);
  const parsed = parseExperienceEditForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(here, 'invalid', parsed.fields));

  const result = await updateExperience(caller, experienceId, parsed.value);
  if (result.status === 'not_found') redirect(experiencesPath);
  if (result.status === 'invalid') {
    redirect(noticeHref(here, 'invalid', result.fields));
  }
  redirect(noticeHref(here, result.status));
}
