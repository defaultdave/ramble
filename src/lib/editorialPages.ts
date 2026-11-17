import { opsEditorialContentCopy } from './copy/opsEditorialContent';
import {
  PageCopyInputSchema,
  RichTextInputSchema,
  editorialLimits,
  pageCopyKinds,
  publishStatuses,
  type PageCopy,
  type PageCopyInput,
} from './editorial';
import {
  editorialPath,
  entryIntents,
  entryStatusLabels,
  entryStatusTones,
  savedNotice,
  statusAfter,
  type EntryIntent,
  type PublishStatus,
} from './editorialAdmin';
import { defaultHostTimeZone } from './hostSetup';
import {
  fieldsFromIssues,
  formJson,
  formText,
  noticeHref,
  oversizedFields,
  parseIdField,
  rawFormFieldLimit,
  type FormGetter,
} from './opsForm';
import { pickKnown } from './pickKnown';
import { docOrNull } from './richText/paragraphs';
import type { StatusTone } from './statusBadge';
import type { TaxonomyTerm } from './taxonomy';
import { zonedDeadlineLabel } from './zonedLabels';

// The ops page copy (PRD-50): the heading, search description, introduction and text of each
// category and neighborhood page. A page has no copy until it is first saved; copy saves as a
// draft, publishes, or is taken down, as the button pressed says.

const copy = opsEditorialContentCopy.pages;

export const pagesPath = `${editorialPath}/pages`;
const pageCopyPath = (kind: PageCopy['kind'], id: string) =>
  `${pagesPath}/${kind}/${id}`;

export type PageKind = PageCopy['kind'];

/** The kind an address names, or null. */
export function parsePageKind(raw: string): PageKind | null {
  return pickKnown(raw, pageCopyKinds, null);
}

export const pageFormFields = [
  'heading',
  'metaDescription',
  'intro',
  'body',
] as const;
export type PageFormField = (typeof pageFormFields)[number];

export const pageFieldProblems = {
  heading: copy.problems.heading(editorialLimits.heading),
  metaDescription: copy.problems.metaDescription(
    editorialLimits.metaDescription,
  ),
  intro: copy.problems.intro,
  body: copy.problems.body,
} satisfies Record<PageFormField, string>;

/** One page of the list: a term, and the status of the copy it has, if any. */
export type PageRow = {
  id: string;
  name: string;
  slug: string;
  href: string;
  retired: boolean;
  /** Empty when the page has no copy yet. */
  status: PublishStatus | null;
  statusLabel: string;
  statusTone: StatusTone;
  updatedLabel: string;
};

/** The copy of one term, matched by kind and address. */
function copyOf(
  copies: readonly PageCopy[],
  kind: PageKind,
  slug: string,
): PageCopy | null {
  return (
    copies.find((found) => found.kind === kind && found.slug === slug) ?? null
  );
}

export function buildPageRows(
  kind: PageKind,
  terms: readonly TaxonomyTerm[],
  copies: readonly PageCopy[],
): PageRow[] {
  return terms.map((term) => {
    const found = copyOf(copies, kind, term.slug);
    return {
      id: term.id,
      name: term.name,
      slug: term.slug,
      href: pageCopyPath(kind, term.id),
      retired: term.retiredAt !== null,
      status: found?.status ?? null,
      statusLabel: found ? entryStatusLabels[found.status] : copy.states.none,
      statusTone: found ? entryStatusTones[found.status] : 'neutral',
      updatedLabel: found
        ? zonedDeadlineLabel(found.updatedAt, defaultHostTimeZone)
        : '',
    };
  });
}

/** The term an address names with the copy it has, or null for an id that is no term of that kind. */
export function findPageTarget(
  terms: readonly TaxonomyTerm[],
  copies: readonly PageCopy[],
  kind: PageKind,
  rawId: string,
): { term: TaxonomyTerm; copy: PageCopy | null } | null {
  const id = parseIdField(rawId);
  const term = terms.find((found) => found.id === id);
  return term === undefined
    ? null
    : { term, copy: copyOf(copies, kind, term.slug) };
}

export type PageForm =
  | {
      ok: true;
      value: { input: PageCopyInput; intent: EntryIntent };
    }
  | { ok: false; kind: PageKind; targetId: string; fields: PageFormField[] };

/**
 * The posted copy form. A form that names no term of a known kind is `null`. A field too long to
 * be read is refused unread. The status the form carries is only what it was opened with: the
 * save settles it against the stored row (`settledStatus`).
 */
export function parsePageForm(get: FormGetter): PageForm | null {
  const kind = pickKnown(formText(get, 'kind'), pageCopyKinds, null);
  const targetId = parseIdField(get('targetId'));
  const intent = pickKnown(formText(get, 'intent'), entryIntents, null);
  if (kind === null || targetId === null || intent === null) return null;
  const refused = (fields: PageFormField[]): PageForm => ({
    ok: false,
    kind,
    targetId,
    fields,
  });

  const oversized: readonly string[] = [
    ...oversizedFields(get, ['heading', 'metaDescription'], rawFormFieldLimit),
    ...oversizedFields(
      get,
      ['intro', 'body'],
      editorialLimits.richTextStoredBytes,
    ),
  ];
  if (oversized.length > 0) {
    return refused(pageFormFields.filter((f) => oversized.includes(f)));
  }
  const current = pickKnown(formText(get, 'status'), publishStatuses, 'draft');
  const rich = (name: 'intro' | 'body') => {
    const posted = formJson(get, name);
    return RichTextInputSchema.nullable().safeParse(
      posted === undefined ? null : posted,
    );
  };
  const intro = rich('intro');
  const body = rich('body');
  const parsed = PageCopyInputSchema.safeParse({
    kind,
    targetId,
    heading: formText(get, 'heading') ?? null,
    metaDescription: formText(get, 'metaDescription') ?? null,
    status: statusAfter(intent, current),
    intro: intro.success ? docOrNull(intro.data) : undefined,
    body: body.success ? docOrNull(body.data) : undefined,
  });
  if (!parsed.success) {
    return refused(fieldsFromIssues(parsed.error.issues, pageFormFields));
  }
  return { ok: true, value: { input: parsed.data, intent } };
}

export const pageNoticeCodes = [
  'saved',
  'published',
  'unpublished',
  'not_found',
  'invalid',
] as const;
export const pageNotices = copy.notices;

export type PageOutcome =
  | { status: 'saved'; id: string; kind: PageKind; intent: EntryIntent }
  | { status: 'not_found' }
  | {
      status: 'invalid';
      kind: PageKind;
      id: string;
      fields: readonly PageFormField[];
    };

/** The save's answer as far as the redirect needs it: the data layer's result fits this shape. */
export type PageSaveResult =
  { status: 'saved'; value: { kind: PageKind } } | { status: 'unknown_target' };

/** What the action did with a posted form, from what the save answered. */
export function pageOutcomeFor(
  result: PageSaveResult,
  targetId: string,
  intent: EntryIntent,
): PageOutcome {
  return result.status === 'saved'
    ? { status: 'saved', id: targetId, kind: result.value.kind, intent }
    : { status: 'not_found' };
}

/** Where an outcome sends the editor: the page's own form with what the click did, or the list. */
export function pageRedirect(outcome: PageOutcome): string {
  switch (outcome.status) {
    case 'invalid':
      return noticeHref(
        pageCopyPath(outcome.kind, outcome.id),
        'invalid',
        outcome.fields,
      );
    case 'not_found':
      return noticeHref(pagesPath, 'not_found');
    case 'saved':
      return noticeHref(
        pageCopyPath(outcome.kind, outcome.id),
        savedNotice(outcome.intent),
      );
  }
}
