import { z } from 'zod';
import { userActor, type AuditEntryInput } from './audit';
import type { CacheChange } from './cacheTags';
import {
  EntityIdSchema,
  SlugSchema,
  WriteIdSchema,
  catalogLimits,
} from './catalog';
import { swapAt } from './opsForm';
import { requiredText } from './text';

// The categories and neighborhoods ops keeps (PRD-50): add one, rename it, put the list in order,
// retire it. Every rule is here as a plain function; the data layer reads the list under a lock,
// asks these what the click comes to, and writes the answer.

export const taxonomyKinds = ['category', 'neighborhood'] as const;
export type TaxonomyKind = (typeof taxonomyKinds)[number];

/**
 * The numbers the Zod rules and the database CHECKs on `categories` and `neighborhoods` share. A
 * migration holds the same ones, and a test reads them back out of it.
 */
export const taxonomyLimits = {
  name: 80,
  slug: 80,
} as const;

/** The most terms of one kind: the cap the guest reads already carry, and the bound on `position`. */
export function taxonomyCapacity(kind: TaxonomyKind): number {
  return kind === 'category'
    ? catalogLimits.categories
    : catalogLimits.neighborhoods;
}

/** One category or neighborhood as ops sees it: the list order is `position`, then name. */
export const TaxonomyTermSchema = z.object({
  id: EntityIdSchema,
  slug: SlugSchema.max(taxonomyLimits.slug),
  name: requiredText(taxonomyLimits.name),
  position: z.int().nonnegative(),
  retiredAt: z.date().nullable(),
});
export type TaxonomyTerm = z.infer<typeof TaxonomyTermSchema>;

export const TaxonomyAddSchema = z.strictObject({
  kind: z.enum(taxonomyKinds),
  name: requiredText(taxonomyLimits.name),
  slug: SlugSchema.max(taxonomyLimits.slug),
});
export type TaxonomyAdd = z.infer<typeof TaxonomyAddSchema>;

export const TaxonomyRenameSchema = z.strictObject({
  kind: z.enum(taxonomyKinds),
  id: WriteIdSchema,
  name: requiredText(taxonomyLimits.name),
});
export type TaxonomyRename = z.infer<typeof TaxonomyRenameSchema>;

/** The buttons on a list: move a term, retire it, or bring it back. */
const taxonomyActions = ['up', 'down', 'retire', 'restore'] as const;

export const TaxonomyClickSchema = z.strictObject({
  kind: z.enum(taxonomyKinds),
  action: z.enum(taxonomyActions),
  id: WriteIdSchema,
});
export type TaxonomyClick = z.infer<typeof TaxonomyClickSchema>;

/** What a decision leaves for the notice: what the click did. */
export type TaxonomyDone =
  'added' | 'renamed' | 'moved' | 'retired' | 'restored';

/** One term's change, as the data layer writes it. A retire or restore says which, and the data layer stamps the time. */
export type TermChange = {
  id: string;
  name?: string;
  position?: number;
  retired?: boolean;
};

export type TaxonomyDecision =
  | {
      status: 'apply';
      done: Exclude<TaxonomyDone, 'added'>;
      /** The term the click was about, which the audit row names. */
      subjectId: string;
      changes: TermChange[];
    }
  | {
      status: 'create';
      done: 'added';
      slug: string;
      name: string;
      position: number;
    }
  | {
      status: 'refused';
      reason:
        'stale' | 'last_active' | 'slug_taken' | 'name_taken' | 'list_full';
    }
  | { status: 'unchanged' };

const isActive = (term: Pick<TaxonomyTerm, 'retiredAt'>) =>
  term.retiredAt === null;

/** A name compared the way a person reads two names: case and the spaces around it do not tell them apart. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Adds a term at the end of the list. An address another term has is `slug_taken`, a name another
 * term has is `name_taken`, and a full list is `list_full`.
 */
export function decideAdd(
  kind: TaxonomyKind,
  terms: readonly TaxonomyTerm[],
  input: Pick<TaxonomyAdd, 'name' | 'slug'>,
): TaxonomyDecision {
  if (terms.length >= taxonomyCapacity(kind)) {
    return { status: 'refused', reason: 'list_full' };
  }
  if (terms.some((term) => term.slug === input.slug)) {
    return { status: 'refused', reason: 'slug_taken' };
  }
  if (terms.some((term) => sameName(term.name, input.name))) {
    return { status: 'refused', reason: 'name_taken' };
  }
  return {
    status: 'create',
    done: 'added',
    slug: input.slug,
    name: input.name,
    position: terms.length,
  };
}

/**
 * Renames a term; its address stays, because the pages and links already use it. A term that is
 * gone is `stale`, the same name changes nothing, and a name another term has is `name_taken`.
 */
export function decideRename(
  terms: readonly TaxonomyTerm[],
  input: Pick<TaxonomyRename, 'id' | 'name'>,
): TaxonomyDecision {
  const target = terms.find((term) => term.id === input.id);
  if (target === undefined) return { status: 'refused', reason: 'stale' };
  if (target.name === input.name) return { status: 'unchanged' };
  if (
    terms.some(
      (term) => term.id !== target.id && sameName(term.name, input.name),
    )
  ) {
    return { status: 'refused', reason: 'name_taken' };
  }
  return {
    status: 'apply',
    done: 'renamed',
    subjectId: target.id,
    changes: [{ id: target.id, name: input.name }],
  };
}

/**
 * What a button on the list comes to, for the list as read under the lock. A button drawn for a
 * term that is no longer in that state is `stale`: nothing is written. The last term that is not
 * retired cannot be retired, because an experience must name one of each kind. A term in use
 * can be retired: experiences that name it keep it, and only a new choice cannot.
 */
export function decideClick(
  terms: readonly TaxonomyTerm[],
  click: Pick<TaxonomyClick, 'action' | 'id'>,
): TaxonomyDecision {
  const at = terms.findIndex((term) => term.id === click.id);
  const target = terms[at];
  if (target === undefined) return { status: 'refused', reason: 'stale' };
  switch (click.action) {
    case 'up':
    case 'down': {
      const moved = swapAt(terms, at, click.action === 'up' ? at - 1 : at + 1);
      if (moved === null) return { status: 'refused', reason: 'stale' };
      return {
        status: 'apply',
        done: 'moved',
        subjectId: target.id,
        changes: positionsAfterMove(terms, moved),
      };
    }
    case 'retire':
      if (!isActive(target)) return { status: 'refused', reason: 'stale' };
      if (!terms.some((term) => term.id !== target.id && isActive(term))) {
        return { status: 'refused', reason: 'last_active' };
      }
      return {
        status: 'apply',
        done: 'retired',
        subjectId: target.id,
        changes: [{ id: target.id, retired: true }],
      };
    case 'restore':
      if (isActive(target)) return { status: 'refused', reason: 'stale' };
      return {
        status: 'apply',
        done: 'restored',
        subjectId: target.id,
        changes: [{ id: target.id, retired: false }],
      };
  }
}

/** Every term's place in the moved list, written as its position, so a list that began with ties ends with none. */
function positionsAfterMove(
  before: readonly TaxonomyTerm[],
  moved: readonly TaxonomyTerm[],
): TermChange[] {
  const stored = new Map(before.map((term) => [term.id, term.position]));
  return moved.flatMap((term, position) =>
    stored.get(term.id) === position ? [] : [{ id: term.id, position }],
  );
}

/** What a term's retirement leaves the pickers: a retired term is offered only to the experience that already names it. */
export function isOfferable(
  term: Pick<TaxonomyTerm, 'id' | 'retiredAt'>,
  keptId: string | undefined,
): boolean {
  return isActive(term) || term.id === keptId;
}

/**
 * Whether an experience may name this term. A term that is not there cannot be named, and a
 * retired one only by the experience that already names it, so it keeps its place and nobody new
 * takes it.
 */
export function mayReference(
  term: Pick<TaxonomyTerm, 'id' | 'retiredAt'> | undefined,
  keptId: string | undefined,
): boolean {
  return term !== undefined && isOfferable(term, keptId);
}

/** Taxonomy changes reach the filter options, the home rails and the landing pages through one tag. */
export const taxonomyChange: CacheChange = { kind: 'taxonomy' };

/** The audit row of a change to a term: ids and the kind of change, never the name. */
export function taxonomyAuditEntry(
  userId: string,
  kind: TaxonomyKind,
  done: TaxonomyDone,
  termId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: `${kind}.${done}`,
    subjectKind: kind,
    subjectId: termId,
  };
}
