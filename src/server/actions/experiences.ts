'use server';

import { redirect } from 'next/navigation';
import {
  experiencePath,
  experiencesPath,
  newExperiencePath,
  parseExperienceCreateForm,
  parseExperienceEditForm,
} from '@/lib/experienceEditor';
import { noticeHref } from '@/lib/opsForm';
import {
  createExperience,
  updateExperience,
} from '@/server/db/experienceEditor';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';

export async function createExperienceAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(experiencesPath);
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
  const caller = await opsCallerOrLeave(experiencesPath);
  const experienceId = idOrLeave(formData, 'experienceId', experiencesPath);
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
