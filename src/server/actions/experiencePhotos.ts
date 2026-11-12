'use server';

import { redirect } from 'next/navigation';
import { experiencePath, experiencesPath } from '@/lib/experienceEditor';
import { noticeHref, parseIdField } from '@/lib/opsForm';
import { parsePhotoForm, photoRefusalNotice } from '@/lib/photoForm';
import {
  ExperienceNotFoundError,
  PhotoLimitError,
  addPhoto,
} from '@/server/db/photos';
import { opsCallerOrLeave } from '@/server/opsAccess';
import { PhotoRefusedError } from '@/server/photos/ingest';
import { systemClock } from '@/server/ports/clock';
import { getStorage } from '@/server/ports/storage/config';

/** Adds one photo, with its alt text and rights, to the experience the form names. The file is read only once its size is within the limit. */
export async function addExperiencePhotoAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(experiencesPath);
  const experienceId = parseIdField(formData.get('experienceId'));
  if (experienceId === null) redirect(experiencesPath);
  const here = experiencePath(experienceId);
  const parsed = parsePhotoForm((name) => formData.get(name), experienceId);
  if (parsed.status === 'invalid') {
    redirect(noticeHref(here, 'photo_invalid', parsed.fields));
  }
  if (parsed.status === 'refused') {
    redirect(noticeHref(here, photoRefusalNotice(parsed.code), ['photoFile']));
  }

  try {
    await addPhoto(
      caller,
      parsed.input,
      new Uint8Array(await parsed.file.arrayBuffer()),
      getStorage(() => systemClock.now()),
    );
  } catch (error) {
    if (error instanceof ExperienceNotFoundError) redirect(experiencesPath);
    if (error instanceof PhotoLimitError) {
      redirect(noticeHref(here, 'photo_limit'));
    }
    if (error instanceof PhotoRefusedError) {
      redirect(noticeHref(here, photoRefusalNotice(error.code), ['photoFile']));
    }
    throw error;
  }
  redirect(noticeHref(here, 'photo_added'));
}
