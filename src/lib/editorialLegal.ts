import { userActor, type AuditEntryInput } from './audit';
import { opsEditorialContentCopy } from './copy/opsEditorialContent';
import { RichTextInputSchema, editorialLimits } from './editorial';
import {
  editorialPath,
  entryStatusLabels,
  entryStatusTones,
} from './editorialAdmin';
import {
  LegalDocSchema,
  legalKindOf,
  type LegalDocument,
  type LegalKind,
} from './legal';
import {
  formJson,
  formText,
  noticeHref,
  oversizedFields,
  parseIdField,
  rawFormFieldLimit,
  type FormGetter,
} from './opsForm';
import { pickKnown } from './pickKnown';
import { hasContent } from './richText/paragraphs';
import type { RichTextDoc } from './richText/format';
import type { StatusTone } from './statusBadge';
import { zonedDeadlineLabel } from './zonedLabels';
import { defaultHostTimeZone } from './hostSetup';
import { requiredText } from './text';

// The ops legal documents (PRD-24, 50): each document has numbered versions. A new version starts
// as a draft, a draft can be edited, and publishing makes it the current version and final.

const copy = opsEditorialContentCopy.legal;

export const legalAdminPath = `${editorialPath}/legal`;
export const legalDocPath = (doc: string) => `${legalAdminPath}/${doc}`;
export const legalVersionPath = (doc: string, id: string) =>
  `${legalDocPath(doc)}/${id}`;

/** The documents that exist from the start: a first version can be drafted before any is stored. */
const fixedLegalDocs = ['terms', 'privacy', 'host-agreement'] as const;

/** Whether a first or next draft may be started for this key: one of the fixed documents, or a key that already has a version. A typed key never makes a new document. */
export function mayStartDraft(
  doc: string,
  storedDocs: readonly string[],
): boolean {
  return (
    pickKnown(doc, fixedLegalDocs, null) !== null || storedDocs.includes(doc)
  );
}

/** One stored document key with its counts, as the read groups them. */
export type LegalDocSummary = {
  doc: string;
  versions: number;
  latestVersion: number;
  publishedVersion: number | null;
};

export type LegalDocRow = {
  doc: string;
  label: string;
  href: string;
  /** What is live and what is waiting, in a sentence. */
  state: string;
};

const kindLabels = copy.kinds satisfies Record<LegalKind, string>;

/** The name of a document: its kind, and for a waiver its key too, since there are many. */
export function legalDocLabel(doc: string): string {
  const kind = legalKindOf(doc);
  if (kind === null) return doc;
  return kind === 'waiver' ? `${kindLabels.waiver}: ${doc}` : kindLabels[kind];
}

function docState(summary: LegalDocSummary | undefined): string {
  if (summary === undefined) return copy.states.none;
  const published =
    summary.publishedVersion === null
      ? copy.states.notPublished
      : copy.states.published(summary.publishedVersion);
  return summary.latestVersion > (summary.publishedVersion ?? 0)
    ? `${published} ${copy.states.draftWaiting(summary.latestVersion)}`
    : published;
}

/** The fixed documents first, then the others (waivers) as stored, each with its state. */
export function buildLegalDocRows(
  summaries: readonly LegalDocSummary[],
): LegalDocRow[] {
  const byDoc = new Map(summaries.map((summary) => [summary.doc, summary]));
  const docs = [
    ...fixedLegalDocs,
    ...summaries
      .map(({ doc }) => doc)
      .filter((doc) => !pickKnown(doc, fixedLegalDocs, null)),
  ];
  return docs.map((doc) => ({
    doc,
    label: legalDocLabel(doc),
    href: legalDocPath(doc),
    state: docState(byDoc.get(doc)),
  }));
}

/** The key an address names, or null for one that is no document key. */
export function parseLegalDocParam(raw: string): string | null {
  const parsed = LegalDocSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type LegalVersionRow = {
  id: string;
  version: number;
  title: string;
  statusLabel: string;
  statusTone: StatusTone;
  /** The time it went live, or empty for a draft. */
  publishedLabel: string;
  /** Only a draft has an editor: a published version is final. */
  editHref: string | null;
};

export function buildLegalVersionRows(
  versions: readonly LegalDocument[],
): LegalVersionRow[] {
  return versions.map((version) => ({
    id: version.id,
    version: version.version,
    title: version.title,
    statusLabel: entryStatusLabels[version.status],
    statusTone: entryStatusTones[version.status],
    publishedLabel:
      version.publishedAt === null
        ? ''
        : zonedDeadlineLabel(version.publishedAt, defaultHostTimeZone),
    editHref:
      version.status === 'draft'
        ? legalVersionPath(version.doc, version.id)
        : null,
  }));
}

/** The version an address names among a document's versions, or null. */
export function findVersion(
  versions: readonly LegalDocument[],
  id: string,
): LegalDocument | null {
  const wanted = parseIdField(id);
  return versions.find((version) => version.id === wanted) ?? null;
}

/** What a new draft starts from: the newest version's words, so a revision is an edit and not a retype. */
export function draftStart(versions: readonly LegalDocument[]): {
  title: string;
  body: RichTextDoc | null;
} {
  const [latest] = versions;
  return { title: latest?.title ?? '', body: latest?.body ?? null };
}

// ---- The forms ----

export const legalFormFields = ['title', 'body'] as const;
export type LegalFormField = (typeof legalFormFields)[number];

export const legalFieldProblems = {
  title: copy.problems.title(editorialLimits.title),
  body: copy.problems.body,
} satisfies Record<LegalFormField, string>;

const legalIntents = ['save', 'publish'] as const;
export type LegalIntent = (typeof legalIntents)[number];

export type LegalForm =
  | {
      ok: true;
      value: { title: string; body: RichTextDoc; intent: LegalIntent };
    }
  | { ok: false; fields: LegalFormField[] };

const TitleSchema = requiredText(editorialLimits.title);

/** The posted title and body. A field too long to be read is refused unread, and a form with no known button changes nothing. */
export function parseLegalForm(get: FormGetter): LegalForm {
  const oversized = [
    ...oversizedFields(get, ['title'], rawFormFieldLimit),
    ...oversizedFields(get, ['body'], editorialLimits.richTextStoredBytes),
  ];
  if (oversized.length > 0) {
    return {
      ok: false,
      fields: legalFormFields.filter((field) => oversized.includes(field)),
    };
  }
  const intent = pickKnown(formText(get, 'intent'), legalIntents, null);
  if (intent === null) return { ok: false, fields: [] };
  const title = TitleSchema.safeParse(formText(get, 'title'));
  const body = RichTextInputSchema.safeParse(formJson(get, 'body'));
  const failed: LegalFormField[] = [
    ...(title.success ? [] : (['title'] as const)),
    ...(body.success ? [] : (['body'] as const)),
  ];
  if (!title.success || !body.success) return { ok: false, fields: failed };
  // A version with no text cannot go live.
  if (intent === 'publish' && !hasContent(body.data)) {
    return { ok: false, fields: ['body'] };
  }
  return {
    ok: true,
    value: { title: title.data, body: body.data, intent },
  };
}

/** Whether a save that came through is followed by the publish the button asked for. */
export function wantsPublish(
  intent: LegalIntent,
  edited: { status: 'saved' | 'not_a_draft' },
): boolean {
  return intent === 'publish' && edited.status === 'saved';
}

// ---- Where each outcome goes ----

export const legalNoticeCodes = [
  'drafted',
  'saved',
  'published',
  'not_a_draft',
  'superseded',
  'invalid',
] as const;
export const legalNotices = copy.notices;

export type LegalOutcome =
  | {
      status:
        | 'drafted'
        | 'saved'
        | 'published'
        | 'not_a_draft'
        | 'superseded'
        | 'unknown_document';
    }
  | { status: 'invalid'; fields: readonly LegalFormField[] };

/** What the edit and the publish after it came to. A draft that is gone or final is `not_a_draft`, whichever step found it so. */
export function legalOutcomeFor(
  intent: LegalIntent,
  edited: { status: 'saved' | 'not_a_draft' },
  published: { status: 'published' | 'not_a_draft' | 'superseded' } | undefined,
): LegalOutcome {
  if (edited.status !== 'saved') return { status: 'not_a_draft' };
  if (intent === 'save') return { status: 'saved' };
  if (published === undefined) throw new Error('The publish was not made');
  return { status: published.status };
}

/**
 * Where an outcome sends the editor. A draft just made opens in its editor; a refused form returns
 * to the form it came from; the rest go back to the document's versions.
 */
export function legalRedirect(
  doc: string,
  editing: { id: string } | null,
  outcome: LegalOutcome,
): string {
  const here =
    editing === null ? legalDocPath(doc) : legalVersionPath(doc, editing.id);
  switch (outcome.status) {
    case 'invalid':
      return noticeHref(here, 'invalid', outcome.fields);
    case 'saved':
      return noticeHref(here, 'saved');
    case 'unknown_document':
      return legalAdminPath;
    default:
      return noticeHref(legalDocPath(doc), outcome.status);
  }
}

// ---- Audit ----

export type LegalAuditAction = 'drafted' | 'edited' | 'published';

/** The audit row of a change to a version: ids, the document key and the version number, never the text. */
export function legalAuditEntry(
  userId: string,
  action: LegalAuditAction,
  document: Pick<LegalDocument, 'id' | 'doc' | 'version'>,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: `legal_document.${action}`,
    subjectKind: 'legal_document',
    subjectId: document.id,
    details: { doc: document.doc, version: document.version },
  };
}
