import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import {
  TaxonomyAddSchema,
  TaxonomyClickSchema,
  TaxonomyRenameSchema,
  TaxonomyTermSchema,
  decideAdd,
  decideClick,
  decideRename,
  taxonomyAuditEntry,
  taxonomyCapacity,
  taxonomyChange,
  type TaxonomyAdd,
  type TaxonomyClick,
  type TaxonomyDecision,
  type TaxonomyDone,
  type TaxonomyKind,
  type TaxonomyRename,
  type TaxonomyTerm,
  type TermChange,
} from '@/lib/taxonomy';
import type { Caller } from '@/server/auth/caller';
import { Role } from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { requireUserId, writeAudit } from './audit';
import { db, dbRead, type Transaction } from './client';
import { lockFor } from './locks';
import { categories, neighborhoods } from './schema';
import { requireStaff } from './staff';

// The categories and neighborhoods. A change reads the whole list of its kind under a lock, asks
// `src/lib/taxonomy.ts` what the click comes to, writes that, and writes the audit row in the
// same transaction. The guest pages read the lists through `getFilterOptions`, which the
// `taxonomy` tag evicts after the commit; this runs in a Server Action only.

const tableOf = (kind: TaxonomyKind) =>
  kind === 'category' ? categories : neighborhoods;

const orderOf = (table: ReturnType<typeof tableOf>) => [
  asc(table.position),
  asc(table.name),
  asc(table.id),
];

/** Every term of a kind, retired ones too, in the order guests see them. Up to the kind's capacity. */
export async function readTaxonomyTerms(
  kind: TaxonomyKind,
): Promise<TaxonomyTerm[]> {
  const table = tableOf(kind);
  const rows = await dbRead
    .select()
    .from(table)
    .orderBy(...orderOf(table))
    .limit(taxonomyCapacity(kind));
  return TaxonomyTermSchema.array().parse(rows);
}

/** The terms of a kind for the editor, retired ones included. */
export async function listTaxonomyForEditing(
  caller: Caller,
  kind: TaxonomyKind,
): Promise<TaxonomyTerm[]> {
  requireStaff(caller);
  return readTaxonomyTerms(kind);
}

/**
 * The term an experience is about to name, read with a shared row lock so a retire that commits
 * after this read waits for the experience's save, and one that committed before it is seen.
 * Undefined for an id that is no term.
 */
export async function lockReferencedTerm(
  tx: Transaction,
  kind: TaxonomyKind,
  id: string,
): Promise<Pick<TaxonomyTerm, 'id' | 'retiredAt'> | undefined> {
  const table = tableOf(kind);
  const [row] = await tx
    .select({ id: table.id, retiredAt: table.retiredAt })
    .from(table)
    .where(eq(table.id, id))
    .for('share');
  return row;
}

export type SaveTaxonomyResult =
  | { status: 'saved'; done: TaxonomyDone }
  | { status: 'unchanged' }
  | {
      status: 'refused';
      reason: Extract<TaxonomyDecision, { status: 'refused' }>['reason'];
    };

async function writeChanges(
  tx: Transaction,
  kind: TaxonomyKind,
  changes: readonly TermChange[],
): Promise<void> {
  const table = tableOf(kind);
  for (const change of changes) {
    await tx
      .update(table)
      .set({
        name: change.name,
        position: change.position,
        retiredAt:
          change.retired === undefined
            ? undefined
            : change.retired
              ? sql`clock_timestamp()`
              : null,
      })
      .where(eq(table.id, change.id));
  }
}

/**
 * The one transaction of a change: the lock that serializes writers of this kind, the list read
 * under row locks (which a save of an experience's shared lock on a term waits for), the lib's
 * decision, the write, and the audit row. A refusal or an unchanged answer writes nothing.
 */
async function changeTerms(
  caller: Caller,
  kind: TaxonomyKind,
  decide: (terms: TaxonomyTerm[]) => TaxonomyDecision,
): Promise<SaveTaxonomyResult> {
  requireStaff(caller);
  const userId = requireUserId(caller, Role.Ops);
  const table = tableOf(kind);
  const outcome = await db.transaction(
    async (tx): Promise<SaveTaxonomyResult> => {
      await lockFor(tx, `taxonomy:${kind}`);
      const rows = await tx
        .select()
        .from(table)
        .orderBy(...orderOf(table))
        .limit(taxonomyCapacity(kind))
        .for('update');
      const decision = decide(TaxonomyTermSchema.array().parse(rows));
      if (decision.status === 'refused') return decision;
      if (decision.status === 'unchanged') return decision;
      if (decision.status === 'create') {
        const [created] = await tx
          .insert(table)
          .values({
            slug: decision.slug,
            name: decision.name,
            position: decision.position,
          })
          .returning({ id: table.id });
        if (!created) throw new Error('The term write returned no row');
        await writeAudit(
          tx,
          taxonomyAuditEntry(userId, kind, decision.done, created.id),
        );
        return { status: 'saved', done: decision.done };
      }
      await writeChanges(tx, kind, decision.changes);
      await writeAudit(
        tx,
        taxonomyAuditEntry(userId, kind, decision.done, decision.subjectId),
      );
      return { status: 'saved', done: decision.done };
    },
  );
  if (outcome.status === 'saved') updateTagsForChanges([taxonomyChange]);
  return outcome;
}

/** Adds a term at the end of its list. */
export async function addTaxonomyTerm(
  caller: Caller,
  input: TaxonomyAdd,
): Promise<SaveTaxonomyResult> {
  requireStaff(caller);
  const parsed = TaxonomyAddSchema.parse(input);
  return changeTerms(caller, parsed.kind, (terms) =>
    decideAdd(parsed.kind, terms, parsed),
  );
}

/** Renames a term. Its address stays. */
export async function renameTaxonomyTerm(
  caller: Caller,
  input: TaxonomyRename,
): Promise<SaveTaxonomyResult> {
  requireStaff(caller);
  const parsed = TaxonomyRenameSchema.parse(input);
  return changeTerms(caller, parsed.kind, (terms) =>
    decideRename(terms, parsed),
  );
}

/** A button on a list: move a term, retire it, or bring it back. */
export async function clickTaxonomyTerm(
  caller: Caller,
  click: TaxonomyClick,
): Promise<SaveTaxonomyResult> {
  requireStaff(caller);
  const parsed = TaxonomyClickSchema.parse(click);
  return changeTerms(caller, parsed.kind, (terms) =>
    decideClick(terms, parsed),
  );
}
