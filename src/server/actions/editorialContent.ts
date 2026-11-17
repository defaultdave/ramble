'use server';

import { redirect } from 'next/navigation';
import {
  guideOutcomeFor,
  guidesPath,
  guideRedirect,
  parseGuideForm,
} from '@/lib/editorialGuides';
import {
  legalAdminPath,
  legalOutcomeFor,
  legalRedirect,
  legalStartOutcome,
  parseLegalDocParam,
  parseLegalForm,
  wantsPublish,
} from '@/lib/editorialLegal';
import {
  pageOutcomeFor,
  pageRedirect,
  pagesPath,
  parsePageForm,
} from '@/lib/editorialPages';
import {
  noticeCodeFor,
  parseAddForm,
  parseClick,
  parseRenameForm,
  taxonomyPath,
  taxonomyRedirect,
  newTermPath,
  renamePath,
} from '@/lib/editorialTaxonomy';
import { formText } from '@/lib/opsForm';
import { savePageCopy } from '@/server/db/editorial';
import { updateGuideLinks } from '@/server/db/experienceEditor';
import {
  publishLegalDraft,
  saveLegalDraft,
  startLegalDraft,
} from '@/server/db/legalAdmin';
import {
  addTaxonomyTerm,
  clickTaxonomyTerm,
  renameTaxonomyTerm,
} from '@/server/db/taxonomy';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';

/**
 * The copy form of a category or neighborhood page: saves it as a draft, publishes it, or takes
 * it down, as the button pressed says. `savePageCopy` settles the status against the stored row,
 * writes the audit row, and clears the guest tags for what guests could see before and after.
 */
export async function savePageCopyAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(pagesPath);
  const form = parsePageForm((name) => formData.get(name));
  if (form === null) redirect(pageRedirect({ status: 'not_found' }));
  if (!form.ok) {
    redirect(
      pageRedirect({
        status: 'invalid',
        kind: form.kind,
        id: form.targetId,
        fields: form.fields,
      }),
    );
  }

  const { input, intent } = form.value;
  const result = await savePageCopy(caller, input, intent);
  redirect(pageRedirect(pageOutcomeFor(result, input.targetId, intent)));
}

/**
 * The links form of a guide entry. The stored experience is read, the two links are replaced in
 * its content, and the whole is saved by the experience editor's own save, so the rules, the
 * audit row, and the cache clearing are that save's.
 */
export async function saveGuideLinksAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(guidesPath);
  const id = idOrLeave(formData, 'id', guidesPath);
  const form = parseGuideForm((name) => formData.get(name));
  if (!form.ok) {
    redirect(guideRedirect(id, { status: 'invalid', fields: form.fields }));
  }

  const result = await updateGuideLinks(caller, id, form.value);
  redirect(guideRedirect(id, guideOutcomeFor(result)));
}

/** The form that starts the next version of a legal document as a draft. */
export async function startLegalDraftAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(legalAdminPath);
  const get = (name: string) => formData.get(name);
  const doc = parseLegalDocParam(formText(get, 'doc') ?? '');
  if (doc === null) redirect(legalAdminPath);
  const form = parseLegalForm(get);
  if (!form.ok) {
    redirect(
      legalRedirect(doc, null, { status: 'invalid', fields: form.fields }),
    );
  }

  const { title, body } = form.value;
  const result = await startLegalDraft(caller, { doc, title, body });
  redirect(legalRedirect(doc, null, legalStartOutcome(result)));
}

/** The edit form of a draft: saves it, or saves it and publishes it as the button pressed says. */
export async function saveLegalDraftAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(legalAdminPath);
  const get = (name: string) => formData.get(name);
  const doc = parseLegalDocParam(formText(get, 'doc') ?? '');
  if (doc === null) redirect(legalAdminPath);
  const id = idOrLeave(formData, 'id', legalAdminPath);
  const form = parseLegalForm(get);
  if (!form.ok) {
    redirect(
      legalRedirect(doc, { id }, { status: 'invalid', fields: form.fields }),
    );
  }

  const { title, body, intent } = form.value;
  const edited = await saveLegalDraft(caller, id, { title, body });
  const published = wantsPublish(intent, edited)
    ? await publishLegalDraft(caller, id)
    : undefined;
  redirect(
    legalRedirect(doc, { id }, legalOutcomeFor(intent, edited, published)),
  );
}

/** The add form of a category or neighborhood: the new term goes at the end of its list. */
export async function addTaxonomyAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(taxonomyPath);
  const form = parseAddForm((name) => formData.get(name));
  if (form === null) redirect(taxonomyRedirect(null, 'stale'));
  if (!form.ok) {
    redirect(taxonomyRedirect(form.form, 'invalid', form.fields));
  }

  const result = await addTaxonomyTerm(caller, form.value);
  redirect(
    taxonomyRedirect(newTermPath(form.value.kind), noticeCodeFor(result)),
  );
}

/** The rename form of a category or neighborhood. Its address stays. */
export async function renameTaxonomyAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(taxonomyPath);
  const form = parseRenameForm((name) => formData.get(name));
  if (form === null) redirect(taxonomyRedirect(null, 'stale'));
  if (!form.ok) {
    redirect(taxonomyRedirect(form.form, 'invalid', form.fields));
  }

  const { kind, id } = form.value;
  const result = await renameTaxonomyTerm(caller, form.value);
  redirect(taxonomyRedirect(renamePath(kind, id), noticeCodeFor(result)));
}

/** A button on a list: move a category or neighborhood, retire it, or bring it back. */
export async function taxonomyClickAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(taxonomyPath);
  const click = parseClick((name) => formData.get(name));
  if (click === null) redirect(taxonomyRedirect(null, 'stale'));

  const result = await clickTaxonomyTerm(caller, click);
  redirect(taxonomyRedirect(null, noticeCodeFor(result)));
}
