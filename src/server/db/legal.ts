import 'server-only';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import { editorialLimits } from '@/lib/editorial';
import {
  LegalAcceptancesInputSchema,
  LegalDocSchema,
  LegalDocumentSchema,
  LegalDraftEditSchema,
  LegalDraftInputSchema,
  legalChange,
  type LegalAcceptancesInput,
  type LegalDocument,
  type LegalDraftEdit,
  type LegalDraftInput,
} from '@/lib/legal';
import type { Caller } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { db, dbRead } from './client';
import { legalAcceptances, legalDocuments } from './schema';
import { requireStaff } from './staff';

// TODO(U-038): first caller
/** The highest published version of a document. Null when the key is malformed or nothing is published. */
export async function getCurrentLegalDocument(
  doc: string,
): Promise<LegalDocument | null> {
  const parsed = LegalDocSchema.safeParse(doc);
  if (!parsed.success) return null;
  const [row] = await dbRead
    .select()
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.doc, parsed.data),
        eq(legalDocuments.status, 'published'),
      ),
    )
    .orderBy(desc(legalDocuments.version))
    .limit(1);
  return row ? LegalDocumentSchema.parse(row) : null;
}

// TODO(U-047a): first caller
/** One published version by ID, such as the waiver text an experience points at. */
export async function getPublishedLegalDocument(
  id: string,
): Promise<LegalDocument | null> {
  const parsed = EntityIdSchema.safeParse(id);
  if (!parsed.success) return null;
  const [row] = await dbRead
    .select()
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.id, parsed.data),
        eq(legalDocuments.status, 'published'),
      ),
    );
  return row ? LegalDocumentSchema.parse(row) : null;
}

// TODO(U-076c): first caller
/** Every version of a document, newest first, drafts included. */
export async function listLegalVersions(
  caller: Caller,
  doc: string,
): Promise<LegalDocument[]> {
  requireStaff(caller);
  const parsed = LegalDocSchema.safeParse(doc);
  if (!parsed.success) return [];
  const rows = await dbRead
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.doc, parsed.data))
    .orderBy(desc(legalDocuments.version))
    .limit(editorialLimits.listed);
  return LegalDocumentSchema.array().parse(rows);
}

// TODO(U-076c): first caller
/** Starts the next version of a document as a draft. */
export async function createLegalDraft(
  caller: Caller,
  input: LegalDraftInput,
): Promise<LegalDocument> {
  requireStaff(caller);
  const parsed = LegalDraftInputSchema.parse(input);
  const row = await db.transaction(async (tx) => {
    // The same per-document lock the publish trigger takes, so two drafts never pick one number.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${parsed.doc}))`,
    );
    const [latest] = await tx
      .select({ version: legalDocuments.version })
      .from(legalDocuments)
      .where(eq(legalDocuments.doc, parsed.doc))
      .orderBy(desc(legalDocuments.version))
      .limit(1);
    const [created] = await tx
      .insert(legalDocuments)
      .values({ ...parsed, version: (latest?.version ?? 0) + 1 })
      .returning();
    return created;
  });
  if (!row) throw new Error('The legal draft write returned no row');
  return LegalDocumentSchema.parse(row);
}

export type EditLegalDraftResult =
  { status: 'saved'; value: LegalDocument } | { status: 'not_a_draft' };

// TODO(U-076c): first caller
/** Edits a draft. A published version is final, and an ID that matches no draft is `not_a_draft`. */
export async function editLegalDraft(
  caller: Caller,
  id: string,
  edit: LegalDraftEdit,
): Promise<EditLegalDraftResult> {
  requireStaff(caller);
  const parsedId = EntityIdSchema.safeParse(id);
  if (!parsedId.success) return { status: 'not_a_draft' };
  const parsed = LegalDraftEditSchema.parse(edit);
  const [row] = await db
    .update(legalDocuments)
    .set(parsed)
    .where(
      and(
        eq(legalDocuments.id, parsedId.data),
        eq(legalDocuments.status, 'draft'),
      ),
    )
    .returning();
  return row
    ? { status: 'saved', value: LegalDocumentSchema.parse(row) }
    : { status: 'not_a_draft' };
}

export type PublishLegalResult =
  | { status: 'published'; value: LegalDocument }
  | { status: 'not_a_draft' }
  | { status: 'superseded' };

// TODO(U-076c): first caller
/**
 * Publishes a draft, which makes it the current version and final. A draft below a version
 * already published is `superseded`: publish a new draft instead.
 */
export async function publishLegalDocument(
  caller: Caller,
  id: string,
): Promise<PublishLegalResult> {
  requireStaff(caller);
  const parsedId = EntityIdSchema.safeParse(id);
  if (!parsedId.success) return { status: 'not_a_draft' };
  const outcome = await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(legalDocuments)
      .where(
        and(
          eq(legalDocuments.id, parsedId.data),
          eq(legalDocuments.status, 'draft'),
        ),
      );
    if (!draft) return { status: 'not_a_draft' } as const;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${draft.doc}))`);
    const [newer] = await tx
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(
        and(
          eq(legalDocuments.doc, draft.doc),
          eq(legalDocuments.status, 'published'),
          gt(legalDocuments.version, draft.version),
        ),
      )
      .limit(1);
    if (newer) return { status: 'superseded' } as const;
    const [row] = await tx
      .update(legalDocuments)
      .set({ status: 'published', publishedAt: sql`now()` })
      .where(eq(legalDocuments.id, draft.id))
      .returning();
    if (!row) throw new Error('The legal publish returned no row');
    return { status: 'published', row } as const;
  });
  if (outcome.status !== 'published') return outcome;
  updateTagsForChanges([legalChange(outcome.row.doc)]);
  return { status: 'published', value: LegalDocumentSchema.parse(outcome.row) };
}

/** A transaction handle or the pool: anything that can insert. */
type Inserter = Pick<typeof db, 'insert'>;

// TODO(U-047a): first caller
/**
 * Records that an order or a host accepted these published versions, inside the caller's
 * transaction so an acceptance commits with the order or the host it belongs to. The caller has
 * already established who the subject is (the hold's device, the host's owner). A version that is
 * not published makes the database refuse the insert and the transaction fail. Accepting a
 * version twice is a no-op, so a retried checkout writes nothing new.
 */
export async function recordLegalAcceptances(
  executor: Inserter,
  input: LegalAcceptancesInput,
): Promise<{ recorded: number }> {
  const parsed = LegalAcceptancesInputSchema.parse(input);
  const rows = await executor
    .insert(legalAcceptances)
    .values(
      [...new Set(parsed.documentIds)].map((legalDocumentId) => ({
        legalDocumentId,
        subjectKind: parsed.subjectKind,
        subjectId: parsed.subjectId,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: legalAcceptances.id });
  return { recorded: rows.length };
}
