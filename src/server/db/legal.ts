import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import { editorialLimits } from '@/lib/editorial';
import { hostAgreementAcceptedEntry } from '@/lib/hostAudit';
import {
  decideHostAcceptance,
  hostAgreementDoc,
  type HostAcceptanceOutcome,
  type HostAcceptanceRecord,
} from '@/lib/hostSetup';
import { isHoldOfDevice } from '@/lib/holds';
import {
  OrderAcceptancesInputSchema,
  LegalDocSchema,
  LegalDocumentSchema,
  LegalDraftEditSchema,
  LegalDraftInputSchema,
  isDraft,
  isSuperseded,
  legalChange,
  nextLegalVersion,
  type LegalDocument,
  type LegalDraftEdit,
  type LegalDraftInput,
} from '@/lib/legal';
import { requireRole, Role, type Caller } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import type { Device } from '@/server/device';
import { db, dbRead, type Transaction } from './client';
import { requireOpsUserId, writeAudit } from './audit';
import { lockFor } from './locks';
import {
  holds,
  hosts,
  legalAcceptances,
  legalDocuments,
  orders,
} from './schema';
import { requireStaff } from './staff';

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

/** One published version by ID, such as the waiver text an experience points at. Inside a transaction, pass it so the read sees the same snapshot. */
export async function getPublishedLegalDocument(
  id: string,
  tx?: Transaction,
): Promise<LegalDocument | null> {
  const parsed = EntityIdSchema.safeParse(id);
  if (!parsed.success) return null;
  const [row] = await (tx ?? dbRead)
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
    await lockFor(tx, parsed.doc);
    const [latest] = await tx
      .select({ version: legalDocuments.version })
      .from(legalDocuments)
      .where(eq(legalDocuments.doc, parsed.doc))
      .orderBy(desc(legalDocuments.version))
      .limit(1);
    const [created] = await tx
      .insert(legalDocuments)
      .values({ ...parsed, version: nextLegalVersion(latest?.version) })
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
  const [current] = await db
    .select({ status: legalDocuments.status })
    .from(legalDocuments)
    .where(eq(legalDocuments.id, parsedId.data));
  if (!current || !isDraft(current.status)) return { status: 'not_a_draft' };
  // The status predicate is the race guard: a publish that commits after the read above leaves
  // no row to update, and the answer is the same.
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
 * already published is `superseded`: publish a new draft instead. Everything is read again after
 * the per-document lock, so a publish that lost a race gets a typed answer, not a database error.
 */
export async function publishLegalDocument(
  caller: Caller,
  id: string,
): Promise<PublishLegalResult> {
  requireStaff(caller);
  const parsedId = EntityIdSchema.safeParse(id);
  if (!parsedId.success) return { status: 'not_a_draft' };
  const outcome = await db.transaction(async (tx) => {
    const [named] = await tx
      .select({ doc: legalDocuments.doc })
      .from(legalDocuments)
      .where(eq(legalDocuments.id, parsedId.data));
    if (!named) return { status: 'not_a_draft' } as const;
    await lockFor(tx, named.doc);
    const [draft] = await tx
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.id, parsedId.data));
    if (!draft || !isDraft(draft.status)) {
      return { status: 'not_a_draft' } as const;
    }
    const published = await tx
      .select({ version: legalDocuments.version })
      .from(legalDocuments)
      .where(
        and(
          eq(legalDocuments.doc, draft.doc),
          eq(legalDocuments.status, 'published'),
        ),
      )
      .orderBy(desc(legalDocuments.version))
      .limit(editorialLimits.listed);
    if (
      isSuperseded(
        draft.version,
        published.map(({ version }) => version),
      )
    ) {
      return { status: 'superseded' } as const;
    }
    const [row] = await tx
      .update(legalDocuments)
      // The trigger stamps `published_at` once it holds the lock, so a higher version never
      // carries an earlier time than a lower one.
      .set({ status: 'published' })
      .where(eq(legalDocuments.id, draft.id))
      .returning();
    if (!row) throw new Error('The legal publish returned no row');
    return { status: 'published', row } as const;
  });
  if (outcome.status !== 'published') return outcome;
  updateTagsForChanges([legalChange(outcome.row.doc)]);
  return { status: 'published', value: LegalDocumentSchema.parse(outcome.row) };
}

export type RecordAcceptancesResult =
  { status: 'recorded'; recorded: number } | { status: 'refused' };

/**
 * Records that the guest behind this order accepted each named published version (PRD-24), inside
 * the checkout's open transaction. A guest has no signed-in caller, so the subject check is the
 * device: the order's hold must carry the calling device's key, and any other order, a missing
 * one, or a malformed input is `refused` with nothing written. Accepting a version again is a
 * no-op, so a retry or a second tab records nothing twice. `recorded` counts the new rows.
 */
export async function recordOrderAcceptances(
  tx: Transaction,
  device: Device,
  input: unknown,
): Promise<RecordAcceptancesResult> {
  const parsed = OrderAcceptancesInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'refused' };
  const { orderId, legalDocumentIds } = parsed.data;
  const [owner] = await tx
    .select({ deviceKey: holds.deviceKey })
    .from(orders)
    .innerJoin(holds, eq(holds.id, orders.holdId))
    .where(eq(orders.id, orderId));
  if (!isHoldOfDevice(owner, device.deviceKey)) return { status: 'refused' };
  const rows = await tx
    .insert(legalAcceptances)
    .values(
      legalDocumentIds.map((legalDocumentId) => ({
        legalDocumentId,
        subjectKind: 'order' as const,
        subjectId: orderId,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: legalAcceptances.id });
  return { status: 'recorded', recorded: rows.length };
}

/** The highest published host agreement, read in the caller's transaction so the decision and the write see one version. */
async function currentHostAgreementIn(tx: Transaction) {
  const [row] = await tx
    .select({ id: legalDocuments.id, version: legalDocuments.version })
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.doc, hostAgreementDoc),
        eq(legalDocuments.status, 'published'),
      ),
    )
    .orderBy(desc(legalDocuments.version))
    .limit(1);
  return row ?? null;
}

/**
 * Records, for ops, that a host accepted the agreement version they were shown (agreement and
 * content rights are one document), inside the caller's open transaction. Only the current
 * version can be accepted: a version published since is `stale`, and accepting the current one
 * again is `already_accepted`; neither writes. The audit row is written with the acceptance.
 */
export async function recordHostAcceptanceIn(
  tx: Transaction,
  caller: Caller,
  hostId: string,
  submittedId: string | null,
): Promise<HostAcceptanceOutcome> {
  const userId = requireOpsUserId(caller);
  const current = await currentHostAgreementIn(tx);
  const accepted = await tx
    .select({ legalDocumentId: legalAcceptances.legalDocumentId })
    .from(legalAcceptances)
    .where(
      and(
        eq(legalAcceptances.subjectKind, 'host'),
        eq(legalAcceptances.subjectId, hostId),
      ),
    )
    .limit(editorialLimits.listed);
  const outcome = decideHostAcceptance({
    currentId: current?.id ?? null,
    submittedId,
    acceptedIds: accepted.map((row) => row.legalDocumentId),
  });
  if (outcome !== 'recorded' || current === null) return outcome;
  const rows = await tx
    .insert(legalAcceptances)
    .values({
      legalDocumentId: current.id,
      subjectKind: 'host',
      subjectId: hostId,
    })
    .onConflictDoNothing()
    .returning({ id: legalAcceptances.id });
  // A second tab that accepted between the read and the write wins; the unique index says so.
  if (rows.length === 0) return 'already_accepted';
  await writeAudit(tx, hostAgreementAcceptedEntry(userId, hostId, current.id));
  return 'recorded';
}

/** Ops records the acceptance for a host on its own. `not_found` for an id that is no host. */
export async function recordHostAcceptance(
  caller: Caller,
  hostId: string,
  submittedId: string | null,
): Promise<HostAcceptanceOutcome | 'not_found'> {
  requireRole(caller, Role.Ops, {});
  return db.transaction(async (tx) => {
    const [host] = await tx
      .select({ id: hosts.id })
      .from(hosts)
      .where(eq(hosts.id, hostId));
    if (!host) return 'not_found';
    return recordHostAcceptanceIn(tx, caller, hostId, submittedId);
  });
}

/** The acceptances recorded for these hosts, newest first, with the version each was against. At most the listed limit per call. */
export async function readHostAcceptances(
  caller: Caller,
  hostIds: readonly string[],
): Promise<(HostAcceptanceRecord & { hostId: string })[]> {
  requireRole(caller, Role.Ops, {});
  if (hostIds.length === 0) return [];
  return dbRead
    .select({
      hostId: legalAcceptances.subjectId,
      legalDocumentId: legalAcceptances.legalDocumentId,
      version: legalDocuments.version,
      acceptedAt: legalAcceptances.acceptedAt,
    })
    .from(legalAcceptances)
    .innerJoin(
      legalDocuments,
      eq(legalDocuments.id, legalAcceptances.legalDocumentId),
    )
    .where(
      and(
        eq(legalAcceptances.subjectKind, 'host'),
        inArray(legalAcceptances.subjectId, [...hostIds]),
      ),
    )
    .orderBy(desc(legalAcceptances.acceptedAt), desc(legalAcceptances.id))
    .limit(editorialLimits.listed);
}
