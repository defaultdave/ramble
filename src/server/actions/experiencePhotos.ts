'use server';

import { redirect } from 'next/navigation';
import { experiencePath, experiencesPath } from '@/lib/experienceEditor';
import { noticeHref } from '@/lib/opsForm';
import { parsePhotoForm, photoRefusalNotice } from '@/lib/photoForm';
import type { PhotoRefusalCode } from '@/lib/photos';
import {
  ExperienceNotFoundError,
  PhotoLimitError,
  addPhoto,
} from '@/server/db/photos';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';
import { PhotoRefusedError } from '@/server/photos/ingest';
import { systemClock } from '@/server/ports/clock';
import { getStorage } from '@/server/ports/storage/config';

/** Back to the experience, with the file field saying why the photo was refused. */
function refusedHref(here: string, code: PhotoRefusalCode): string {
  return noticeHref(here, photoRefusalNotice(code), ['photoFile']);
}

/** Adds one photo, with its alt text and rights, to the experience the form names. The file is read only once its size is within the limit. */
export async function addExperiencePhotoAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(experiencesPath);
  const experienceId = idOrLeave(formData, 'experienceId', experiencesPath);
  const here = experiencePath(experienceId);
  const parsed = parsePhotoForm((name) => formData.get(name), experienceId);
  if (parsed.status === 'invalid') {
    redirect(noticeHref(here, 'photo_invalid', parsed.fields));
  }
  if (parsed.status === 'refused') {
    redirect(refusedHref(here, parsed.code));
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
      redirect(refusedHref(here, error.code));
    }
    throw error;
  }
  redirect(noticeHref(here, 'photo_added'));
}
