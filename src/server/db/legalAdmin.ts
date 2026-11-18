import 'server-only';
import { asc, sql } from 'drizzle-orm';
import { editorialLimits } from '@/lib/editorial';
import {
  legalAuditEntry,
  mayStartDraft,
  type LegalDocSummary,
} from '@/lib/editorialLegal';
import {
  LegalDocSchema,
  type LegalDocument,
  type LegalDraftEdit,
  type LegalDraftInput,
} from '@/lib/legal';
import { Role, type Caller } from '@/server/auth/caller';
import { requireUserId } from './audit';
import { dbRead } from './client';
import {
  createLegalDraft,
  editLegalDraft,
  publishLegalDocument,
  type EditLegalDraftResult,
  type PublishLegalResult,
} from './legal';
import { legalDocuments } from './schema';
import { requireStaff } from './staff';

// The ops side of the legal documents. The writes are `legal.ts`'s own; each is handed the entry
// builder for its audit row, which the write puts in its own transaction, so the row exists
// exactly when the change does.

/** Every document key that has a version, with its counts and newest versions. Up to the listed limit. */
export async function listLegalDocSummaries(
  caller: Caller,
): Promise<LegalDocSummary[]> {
  requireStaff(caller);
  return readSummaries();
}

async function readSummaries(): Promise<LegalDocSummary[]> {
  const rows = await dbRead
    .select({
      doc: legalDocuments.doc,
      versions: sql<number>`count(*)::int`,
      latestVersion: sql<number>`max(${legalDocuments.version})::int`,
      publishedVersion: sql<
        number | null
      >`max(${legalDocuments.version}) filter (where ${legalDocuments.status} = 'published')::int`,
    })
    .from(legalDocuments)
    .groupBy(legalDocuments.doc)
    .orderBy(asc(legalDocuments.doc))
    .limit(editorialLimits.listed);
  return rows.map((row) => ({ ...row, doc: LegalDocSchema.parse(row.doc) }));
}

export type StartLegalDraftResult =
  { status: 'drafted'; value: LegalDocument } | { status: 'unknown_document' };

/**
 * Starts the next version of a document as a draft. A key that is not a fixed document and has
 * no version yet is `unknown_document` (`mayStartDraft`), and nothing is written.
 */
export async function startLegalDraft(
  caller: Caller,
  input: LegalDraftInput,
): Promise<StartLegalDraftResult> {
  requireStaff(caller);
  const userId = requireUserId(caller, Role.Ops);
  const stored = await readSummaries();
  if (
    !mayStartDraft(
      input.doc,
      stored.map((row) => row.doc),
    )
  ) {
    return { status: 'unknown_document' };
  }
  const value = await createLegalDraft(caller, input, (document) =>
    legalAuditEntry(userId, 'drafted', document),
  );
  return { status: 'drafted', value };
}

/** Edits a draft; a version already published is final. */
export async function saveLegalDraft(
  caller: Caller,
  id: string,
  edit: LegalDraftEdit,
): Promise<EditLegalDraftResult> {
  requireStaff(caller);
  const userId = requireUserId(caller, Role.Ops);
  return editLegalDraft(caller, id, edit, (document) =>
    legalAuditEntry(userId, 'edited', document),
  );
}

/** Publishes a draft, which makes it the current version and final. */
export async function publishLegalDraft(
  caller: Caller,
  id: string,
): Promise<PublishLegalResult> {
  requireStaff(caller);
  const userId = requireUserId(caller, Role.Ops);
  return publishLegalDocument(caller, id, (document) =>
    legalAuditEntry(userId, 'published', document),
  );
}
