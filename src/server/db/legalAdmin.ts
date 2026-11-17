import 'server-only';
import { asc, sql } from 'drizzle-orm';
import { editorialLimits } from '@/lib/editorial';
import {
  legalAuditEntry,
  mayStartDraft,
  type LegalDocSummary,
} from '@/lib/editorialLegal';
import type { AuditEntryInput } from '@/lib/audit';
import {
  LegalDocSchema,
  type LegalDocument,
  type LegalDraftEdit,
  type LegalDraftInput,
} from '@/lib/legal';
import { Role, type Caller } from '@/server/auth/caller';
import { recordAudit, requireUserId } from './audit';
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

// The ops side of the legal documents. The writes are `legal.ts`'s own, which take no transaction
// of their own, so the audit row of each is written after the write commits, in a transaction of
// its own. A failure to write it throws after the change is made; it cannot be made atomic
// without changing `legal.ts`.

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

/** Runs a write, then records its audit row when it changed something. */
async function audited<T>(
  write: Promise<T>,
  entryFor: (written: T) => AuditEntryInput | null,
): Promise<T> {
  const written = await write;
  const entry = entryFor(written);
  if (entry !== null) await recordAudit(entry);
  return written;
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
  const value = await audited(createLegalDraft(caller, input), (document) =>
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
  return audited(editLegalDraft(caller, id, edit), (result) =>
    result.status === 'saved'
      ? legalAuditEntry(userId, 'edited', result.value)
      : null,
  );
}

/** Publishes a draft, which makes it the current version and final. */
export async function publishLegalDraft(
  caller: Caller,
  id: string,
): Promise<PublishLegalResult> {
  requireStaff(caller);
  const userId = requireUserId(caller, Role.Ops);
  return audited(publishLegalDocument(caller, id), (result) =>
    result.status === 'published'
      ? legalAuditEntry(userId, 'published', result.value)
      : null,
  );
}
