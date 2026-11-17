'use server';

import { redirect } from 'next/navigation';
import {
  editorialPath,
  entryOutcomeFor,
  entryRedirect,
  parseEntryForm,
} from '@/lib/editorialAdmin';
import { parseIdField } from '@/lib/opsForm';
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
  if (!parsed.ok) {
    redirect(
      entryRedirect(postedId, { status: 'invalid', fields: parsed.fields }),
    );
  }

  const { input, intent } = parsed.value;
  const result = await saveHelpArticle(caller, input, intent);
  redirect(entryRedirect(postedId, entryOutcomeFor(result, intent)));
}
