'use server';

import { redirect } from 'next/navigation';
import {
  editorialPath,
  entryOutcomeFor,
  entryRedirect,
  parseEntryForm,
} from '@/lib/editorialAdmin';
import {
  collectionOutcomeFor,
  collectionRedirect,
  collectionsPath,
  findPick,
  parseCollectionForm,
  parseItemOp,
  refusedCollectionOutcome,
  savedCollectionNotice,
  settleCollection,
  settleItems,
} from '@/lib/editorialCollections';
import {
  applyHomeModuleEdit,
  applyHomeModuleOp,
  homeOutcomeFor,
  homePath,
  homeRedirect,
  parseHomeModuleForm,
  parseHomeModuleOp,
  toHomeModulesInput,
} from '@/lib/editorialHome';
import { parseIdField } from '@/lib/opsForm';
import {
  listCollectionsForEditing,
  listHomeModulesForEditing,
  saveCollection,
  saveHelpArticle,
  saveHomeModules,
} from '@/server/db/editorial';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';

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

/**
 * A button on the home modules list: move a module, turn it on, or turn it off. The stored list is
 * read, the click applied to it, and the whole list saved; `saveHomeModules` clears the home tag.
 */
export async function homeModuleOpAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(homePath);
  const op = parseHomeModuleOp((name) => formData.get(name));
  if (op === null) redirect(homeRedirect(null, { status: 'stale' }));

  const modules = toHomeModulesInput(await listHomeModulesForEditing(caller));
  const applied = applyHomeModuleOp(modules, op);
  const saved =
    applied.status === 'changed'
      ? await saveHomeModules(caller, applied.modules)
      : undefined;
  redirect(homeRedirect(null, homeOutcomeFor(applied, saved)));
}

/** The edit form of one home module: its heading, text, Pick and state, saved into the stored list. */
export async function saveHomeModuleAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(homePath);
  const form = parseHomeModuleForm((name) => formData.get(name));
  if (form === null) redirect(homeRedirect(null, { status: 'stale' }));
  if (!form.ok) {
    redirect(
      homeRedirect(form.position, { status: 'invalid', fields: form.fields }),
    );
  }

  const modules = toHomeModulesInput(await listHomeModulesForEditing(caller));
  const applied = applyHomeModuleEdit(modules, form.value);
  const saved =
    applied.status === 'changed'
      ? await saveHomeModules(caller, applied.modules)
      : undefined;
  redirect(homeRedirect(form.value.position, homeOutcomeFor(applied, saved)));
}

/**
 * The details form of a collection: saves it as a draft, publishes it, or takes it down. The
 * stored status and entries are read first and settle what is written; `saveCollection` clears the
 * guest tags for what guests could see before and after.
 */
export async function saveCollectionAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(collectionsPath);
  const parsed = parseCollectionForm((name) => formData.get(name));
  const postedId = parseIdField(formData.get('id'));
  if (!parsed.ok) {
    redirect(collectionRedirect(postedId, refusedCollectionOutcome(parsed)));
  }

  const { value } = parsed;
  const stored =
    value.id === undefined
      ? null
      : findPick(await listCollectionsForEditing(caller), value.id);
  const settled = settleCollection(value, stored);
  if (settled.status !== 'ready') {
    redirect(collectionRedirect(postedId, { status: settled.status }));
  }

  const result = await saveCollection(caller, settled.input);
  redirect(
    collectionRedirect(
      postedId,
      collectionOutcomeFor(result, savedCollectionNotice(value.intent)),
    ),
  );
}

/** A button or the add form on a collection's experience list; the whole collection is saved with the entries changed. */
export async function collectionItemsAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(collectionsPath);
  const id = idOrLeave(formData, 'id', collectionsPath);
  const op = parseItemOp((name) => formData.get(name));
  if (op === null) redirect(collectionRedirect(id, { status: 'entry_stale' }));
  if (!op.ok) {
    redirect(collectionRedirect(id, { status: 'invalid', fields: op.fields }));
  }

  const stored = findPick(await listCollectionsForEditing(caller), id);
  const settled = settleItems(stored, op.op);
  if (settled.status !== 'ready') {
    redirect(collectionRedirect(id, { status: settled.status }));
  }

  const result = await saveCollection(caller, settled.input);
  redirect(collectionRedirect(id, collectionOutcomeFor(result, settled.done)));
}
