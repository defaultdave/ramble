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
  formText,
  noticeHref,
  oversizedFields,
  parseIdField,
  type FormGetter,
  type NoticeText,
} from './opsForm';
import { pickKnown } from './pickKnown';
import { hasContent } from './richText/paragraphs';
import { slugify } from './catalog';
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

export const entryFormFields = ['title', 'slug', 'summary', 'body'] as const;
export type EntryFormField = (typeof entryFormFields)[number];

export const entryFieldProblems = {
  title: `Add a title of up to ${String(editorialLimits.title)} characters.`,
  slug: 'Use lower-case words joined by hyphens, such as how-to-cancel.',
  summary: `Keep the summary to ${String(editorialLimits.summary)} characters.`,
  body: 'Add some text to the body before publishing, and check each link.',
} satisfies Record<EntryFormField, string>;

export type EntryForm =
  | { ok: true; value: { input: HelpArticleInput; intent: EntryIntent } }
  | { ok: false; fields: EntryFormField[] };

const rawFieldLimit = 1000;

/** The posted body as JSON; text that is not JSON goes on as it is, so the schema refuses it and names the field. */
export function parseBody(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * The posted entry form. A blank slug keeps the address the entry has, or is made from the title
 * for a new one. The status and position a form carries are only what it was opened with: the
 * save settles them against the stored row (`saveHelpArticle`). A refused form names the fields
 * to look at and changes nothing.
 */
export function parseEntryForm(get: FormGetter): EntryForm {
  const textFields = ['title', 'slug', 'summary'] as const;
  const oversized = [
    ...oversizedFields(get, textFields, rawFieldLimit),
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
  const current = pickKnown(formText(get, 'status'), publishStatuses, 'draft');
  const title = formText(get, 'title');
  const id = parseIdField(get('id')) ?? undefined;
  const slug =
    formText(get, 'slug') ??
    (id === undefined ? undefined : formText(get, 'currentSlug')) ??
    slugify(title ?? '');

  const parsed = HelpArticleInputSchema.safeParse({
    id,
    slug,
    title,
    summary: formText(get, 'summary') ?? null,
    position: Number(formText(get, 'position') ?? 0),
    status: statusAfter(intent, current),
    body: parseBody(formText(get, 'body')),
  });
  if (!parsed.success) {
    return {
      ok: false,
      fields: fieldsFromIssues(parsed.error.issues, entryFormFields),
    };
  }
  if (parsed.data.status === 'published' && !hasContent(parsed.data.body)) {
    return { ok: false, fields: ['body'] };
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
  invalid: { tone: 'danger', title: 'Some details need another look.' },
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

/** What a save did to the article, from its status before (none for a new one) and after. */
export function entryAuditAction(
  before: PublishStatus | undefined,
  after: PublishStatus,
): string {
  if (before === undefined && after === 'draft') return 'help_article.created';
  if (before !== 'published' && after === 'published') {
    return 'help_article.published';
  }
  if (before === 'published' && after === 'draft') {
    return 'help_article.unpublished';
  }
  return 'help_article.saved';
}

/** The audit row for a save by this caller, or none: the seed saves articles as no one, and each run would add rows to a log the reset keeps. */
export function auditFor(
  userId: string | null,
  before: PublishStatus | undefined,
  after: PublishStatus,
  articleId: string,
): AuditEntryInput | null {
  if (userId === null) return null;
  return entryAuditEntry(userId, entryAuditAction(before, after), articleId);
}

/** One row per save. The text is not written: the audit log holds ids and codes, never words. */
export function entryAuditEntry(
  userId: string,
  action: string,
  articleId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action,
    subjectKind: 'help_article',
    subjectId: articleId,
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
