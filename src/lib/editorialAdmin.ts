import { userActor, type AuditEntryInput } from './audit';
import {
  HelpArticleInputSchema,
  editorialLimits,
  publishStatuses,
  type HelpArticle,
  type HelpArticleInput,
} from './editorial';
import { defaultHostTimeZone } from './hostSetup';
import {
  fieldsFromIssues,
  formJson,
  formText,
  invalidFormNotice,
  noticeHref,
  oversizedFields,
  rawFormFieldLimit,
  parseIdField,
  slugFor,
  slugProblemStart,
  type FormGetter,
  type NoticeText,
} from './opsForm';
import { pickKnown } from './pickKnown';
import { emptyDoc, hasContent } from './richText/paragraphs';
import type { RichTextDoc } from './richText/format';
import type { StatusTone } from './statusBadge';
import { zonedDeadlineLabel } from './zonedLabels';

// The ops editorial area (PRD-50, 53, 54): the editor's entries are help articles, a title, a
// summary and a rich-text body that a person saves as a draft, publishes, or takes back down.

export const editorialPath = '/ops/editorial';
export const newEntryPath = '/ops/editorial/new';
export const entryPath = (id: string) => `${editorialPath}/${id}`;

export type PublishStatus = (typeof publishStatuses)[number];

export const entryStatusLabels = {
  draft: 'Draft',
  published: 'Published',
} satisfies Record<PublishStatus, string>;

export const entryStatusTones = {
  draft: 'warning',
  published: 'success',
} satisfies Record<PublishStatus, StatusTone>;

export const entryIntents = ['save', 'publish', 'unpublish'] as const;
export type EntryIntent = (typeof entryIntents)[number];

/** The status a form leaves an entry in: saving keeps it where it is, the other two move it. */
export function statusAfter(
  intent: EntryIntent,
  current: PublishStatus,
): PublishStatus {
  if (intent === 'publish') return 'published';
  if (intent === 'unpublish') return 'draft';
  return current;
}

/** What a new article starts as; the form carries a status and position only for an article that exists. */
const newEntry: StoredEntry = { status: 'draft', position: 0 };

/** The body the editor opens with: the article's own, or an empty one for a new article. */
export function entryBody(entry: HelpArticle | null): RichTextDoc {
  return entry?.body ?? emptyDoc;
}

/** The stored row a save settles against: the one it locked, or none for a new article. */
export type StoredEntry = { status: PublishStatus; position: number };

export type SettledEntry =
  | { kind: 'settled'; status: PublishStatus; position: number }
  | { kind: 'empty_body' };

/**
 * The status a save leaves a row in. With an intent (the editor's buttons) a replacement takes the
 * status from the stored row, not the form's copy, so a stale tab saving a draft cannot unpublish
 * what another tab published. Without one, or for a new row, the input stands.
 */
export function settledStatus(
  intent: EntryIntent | undefined,
  stored: Pick<StoredEntry, 'status'> | null | undefined,
  inputStatus: PublishStatus,
): PublishStatus {
  return stored && intent ? statusAfter(intent, stored.status) : inputStatus;
}

/**
 * What a save leaves in the row: its status (`settledStatus`) and, for an intent, the position of
 * the stored row. A body with no text cannot stay published.
 */
export function settleEntry(
  intent: EntryIntent | undefined,
  stored: StoredEntry | null | undefined,
  input: Pick<HelpArticleInput, 'status' | 'position' | 'body'>,
): SettledEntry {
  const status = settledStatus(intent, stored, input.status);
  const position = stored && intent ? stored.position : input.position;
  if (status === 'published' && !hasContent(input.body)) {
    return { kind: 'empty_body' };
  }
  return { kind: 'settled', status, position };
}

export const entryFormFields = ['title', 'slug', 'summary', 'body'] as const;
export type EntryFormField = (typeof entryFormFields)[number];

export const entryFieldProblems = {
  title: `Add a title of up to ${String(editorialLimits.title)} characters.`,
  slug: `${slugProblemStart}, such as how-to-cancel.`,
  summary: `Keep the summary to ${String(editorialLimits.summary)} characters.`,
  body: 'Add some text to the body before publishing, and check each link.',
} satisfies Record<EntryFormField, string>;

export type EntryForm =
  | { ok: true; value: { input: HelpArticleInput; intent: EntryIntent } }
  | { ok: false; fields: EntryFormField[] };

/**
 * The posted entry form. A blank slug keeps the address the entry has, or is made from the title
 * for a new one. The status and position a form carries are only what it was opened with: the
 * save settles them against the stored row (`settleEntry`). A refused form names the fields
 * to look at and changes nothing.
 */
export function parseEntryForm(get: FormGetter): EntryForm {
  const textFields = ['title', 'slug', 'summary'] as const;
  const oversized = [
    ...oversizedFields(get, textFields, rawFormFieldLimit),
    ...oversizedFields(get, ['body'], editorialLimits.richTextStoredBytes),
  ];
  if (oversized.length > 0) {
    return {
      ok: false,
      fields: entryFormFields.filter((f) => oversized.includes(f)),
    };
  }

  const intent = pickKnown(formText(get, 'intent'), entryIntents, null);
  if (intent === null) return { ok: false, fields: [] };
  const current = pickKnown(
    formText(get, 'status'),
    publishStatuses,
    newEntry.status,
  );
  const title = formText(get, 'title');
  const id = parseIdField(get('id')) ?? undefined;
  const slug =
    slugFor(
      title ?? '',
      formText(get, 'slug') ??
        (id === undefined ? undefined : formText(get, 'currentSlug')),
      true,
      editorialLimits.slug,
    ) ?? undefined;

  const parsed = HelpArticleInputSchema.safeParse({
    id,
    slug,
    title,
    summary: formText(get, 'summary') ?? null,
    position: Number(formText(get, 'position') ?? newEntry.position),
    status: statusAfter(intent, current),
    body: formJson(get, 'body'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      fields: fieldsFromIssues(parsed.error.issues, entryFormFields),
    };
  }
  return { ok: true, value: { input: parsed.data, intent } };
}

export const entryNoticeCodes = [
  'saved',
  'published',
  'unpublished',
  'slug_taken',
  'not_found',
  'invalid',
] as const;
/** What the save returned, as far as the redirect needs it: the data layer's result fits this shape. */
export type EntrySaveResult =
  | { status: 'saved'; value: { id: string } }
  | { status: 'slug_taken' | 'empty_body' | 'not_found' };

/** The outcome of a save for `entryRedirect`: a saved article carries its id and the button that saved it. */
export function entryOutcomeFor(
  result: EntrySaveResult,
  intent: EntryIntent,
): EntryOutcome {
  return result.status === 'saved'
    ? { status: 'saved', id: result.value.id, intent }
    : { status: result.status };
}

/** What the action did with a posted form, for `entryRedirect`. */
export type EntryOutcome =
  | { status: 'invalid'; fields: readonly EntryFormField[] }
  | { status: 'saved'; id: string; intent: EntryIntent }
  | { status: 'slug_taken' }
  | { status: 'empty_body' }
  | { status: 'not_found' };

/** Where each outcome sends the editor: the edit page with what the click did, the form it came from with the fields to look at, or the list for an article that is gone. */
export function entryRedirect(
  postedId: string | null,
  outcome: EntryOutcome,
): string {
  const here = postedId === null ? newEntryPath : entryPath(postedId);
  switch (outcome.status) {
    case 'invalid':
      return noticeHref(here, 'invalid', outcome.fields);
    case 'slug_taken':
      return noticeHref(here, 'slug_taken', ['slug']);
    case 'empty_body':
      return noticeHref(here, 'invalid', ['body']);
    case 'not_found':
      return noticeHref(editorialPath, 'not_found');
    case 'saved':
      return noticeHref(entryPath(outcome.id), savedNotice(outcome.intent));
  }
}

export type EntryNoticeCode = (typeof entryNoticeCodes)[number];

export const entryNotices = {
  saved: { tone: 'success', title: 'Saved.' },
  published: { tone: 'success', title: 'Published. Guests can read it now.' },
  unpublished: {
    tone: 'info',
    title: 'Taken down. Guests no longer see it, and the draft is kept.',
  },
  slug_taken: {
    tone: 'warning',
    title: 'Another article already uses that address. Choose another.',
  },
  not_found: { tone: 'warning', title: 'That article could not be found.' },
  invalid: invalidFormNotice,
} satisfies Record<EntryNoticeCode, NoticeText>;

/** The notice for a saved entry: what the intent did, which is the point of the click. */
export function savedNotice(intent: EntryIntent): EntryNoticeCode {
  if (intent === 'publish') return 'published';
  return intent === 'unpublish' ? 'unpublished' : 'saved';
}

export type EntryRow = {
  id: string;
  title: string;
  slug: string;
  status: PublishStatus;
  updatedLabel: string;
};

export function buildEntryRows(articles: readonly HelpArticle[]): EntryRow[] {
  return articles.map((article) => ({
    id: article.id,
    title: article.title,
    slug: article.slug,
    status: article.status,
    updatedLabel: zonedDeadlineLabel(article.updatedAt, defaultHostTimeZone),
  }));
}

// ---- Audit ----

/** The kinds of row a save of the editor's entries writes an audit row about. */
type AuditSubject = 'help_article' | 'page_copy';

/** What a save did to the row, from its status before (none for a new one) and after. */
function entryAuditAction(
  subject: AuditSubject,
  before: PublishStatus | undefined,
  after: PublishStatus,
): string {
  if (before === undefined && after === 'draft') return `${subject}.created`;
  if (before !== 'published' && after === 'published') {
    return `${subject}.published`;
  }
  if (before === 'published' && after === 'draft') {
    return `${subject}.unpublished`;
  }
  return `${subject}.saved`;
}

/** The audit row for a save by this caller, or none: the seed saves rows as no one, and each run would add rows to a log the reset keeps. One row per save, holding ids and codes, never the text. */
export function auditFor(
  userId: string | null,
  before: PublishStatus | undefined,
  after: PublishStatus,
  subjectId: string,
  subject: AuditSubject = 'help_article',
): AuditEntryInput | null {
  if (userId === null) return null;
  return {
    ...userActor(userId),
    action: entryAuditAction(subject, before, after),
    subjectKind: subject,
    subjectId,
  };
}

// ---- Small decisions the form components share ----

/** The label of the save button: a published article keeps its status, so the save is plain "Save changes". */
export function saveLabel(status: PublishStatus | undefined): string {
  return status === 'published' ? 'Save changes' : 'Save draft';
}

/** The intent of the second button: take a published article down, or publish a draft. */
export function toggleIntent(
  status: PublishStatus | undefined,
): Extract<EntryIntent, 'publish' | 'unpublish'> {
  return status === 'published' ? 'unpublish' : 'publish';
}

/** The label of the second button, from the intent it posts. */
export function toggleLabel(status: PublishStatus | undefined): string {
  return toggleIntent(status) === 'unpublish' ? 'Unpublish' : 'Publish';
}
