'use server';

import { redirect } from 'next/navigation';
import {
  editorialPath,
  entryPath,
  newEntryPath,
  parseEntryForm,
  savedNotice,
} from '@/lib/editorialAdmin';
import { noticeHref, parseIdField } from '@/lib/opsForm';
import { saveHelpArticle } from '@/server/db/editorial';
import { opsCallerOrLeave } from '@/server/opsAccess';

/**
 * Saves the entry as a draft, publishes it, or takes it down, as the button pressed says.
 * `saveHelpArticle` clears the guest tags when the save changes what guests can read.
 */
export async function saveEntryAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(editorialPath);
  const parsed = parseEntryForm((name) => formData.get(name));
  const postedId = parseIdField(formData.get('id'));
  const here = postedId === null ? newEntryPath : entryPath(postedId);
  if (!parsed.ok) redirect(noticeHref(here, 'invalid', parsed.fields));

  const { input, intent } = parsed.value;
  const result = await saveHelpArticle(caller, input);
  if (result.status === 'not_found') redirect(editorialPath);
  if (result.status === 'slug_taken') {
    redirect(noticeHref(here, 'slug_taken', ['slug']));
  }
  redirect(noticeHref(entryPath(result.value.id), savedNotice(intent)));
}
