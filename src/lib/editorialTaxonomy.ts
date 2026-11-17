import { opsEditorialContentCopy } from './copy/opsEditorialContent';
import { editorialPath } from './editorialAdmin';
import {
  fieldsFromIssues,
  formText,
  noticeHref,
  opValue,
  oversizedFields,
  parseIdField,
  rawFormFieldLimit,
  slugFor,
  splitOp,
  type FormGetter,
} from './opsForm';
import { pickKnown } from './pickKnown';
import type { StatusTone } from './statusBadge';
import {
  TaxonomyAddSchema,
  TaxonomyClickSchema,
  TaxonomyRenameSchema,
  decideClick,
  taxonomyKinds,
  taxonomyLimits,
  type TaxonomyAdd,
  type TaxonomyClick,
  type TaxonomyKind,
  type TaxonomyRename,
  type TaxonomyTerm,
} from './taxonomy';

// The ops categories and neighborhoods (PRD-50): one page lists both kinds with the buttons that
// move, retire and bring back; adding and renaming have a small form each.

const copy = opsEditorialContentCopy.taxonomy;

export const taxonomyPath = `${editorialPath}/taxonomy`;
export const newTermPath = (kind: TaxonomyKind) =>
  `${taxonomyPath}/${kind}/new`;
export const renamePath = (kind: TaxonomyKind, id: string) =>
  `${taxonomyPath}/${kind}/${id}`;

/** The kind an address names, or null. */
export function parseKindParam(raw: string): TaxonomyKind | null {
  return pickKnown(raw, taxonomyKinds, null);
}

// ---- The forms ----

export const taxonomyFormFields = ['name', 'slug'] as const;
export type TaxonomyFormField = (typeof taxonomyFormFields)[number];

export const taxonomyFieldProblems = {
  name: copy.problems.name(taxonomyLimits.name),
  slug: copy.problems.slug,
} satisfies Record<TaxonomyFormField, string>;

/** A refused form names the form to return to and the fields to look at. */
export type TaxonomyForm<V> =
  | { ok: true; value: V }
  | { ok: false; form: string; fields: TaxonomyFormField[] };

function oversized(get: FormGetter): TaxonomyFormField[] {
  return oversizedFields(get, taxonomyFormFields, rawFormFieldLimit);
}

/** The posted add form. A form that names no kind is `null`. A blank address is made from the name, and one that cannot be is refused, never repaired. */
export function parseAddForm(
  get: FormGetter,
): TaxonomyForm<TaxonomyAdd> | null {
  const kind = pickKnown(formText(get, 'kind'), taxonomyKinds, null);
  if (kind === null) return null;
  const form = newTermPath(kind);
  const tooLong = oversized(get);
  if (tooLong.length > 0) return { ok: false, form, fields: tooLong };
  const name = formText(get, 'name');
  const slug = slugFor(
    name ?? '',
    formText(get, 'slug'),
    true,
    taxonomyLimits.slug,
  );
  const parsed = TaxonomyAddSchema.safeParse({ kind, name, slug: slug ?? '' });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        form,
        fields: fieldsFromIssues(parsed.error.issues, taxonomyFormFields),
      };
}

/** The posted rename form. A form that names no term of a known kind is `null`. */
export function parseRenameForm(
  get: FormGetter,
): TaxonomyForm<TaxonomyRename> | null {
  const kind = pickKnown(formText(get, 'kind'), taxonomyKinds, null);
  const id = parseIdField(get('id'));
  if (kind === null || id === null) return null;
  const form = renamePath(kind, id);
  const tooLong = oversized(get);
  if (tooLong.length > 0) return { ok: false, form, fields: tooLong };
  const parsed = TaxonomyRenameSchema.safeParse({
    kind,
    id,
    name: formText(get, 'name'),
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        form,
        fields: fieldsFromIssues(parsed.error.issues, taxonomyFormFields),
      };
}

/** What a list button posts: its action, the kind of list, and the term it was drawn for. */
function clickValue(click: TaxonomyClick): string {
  return opValue(click.action, click.kind, click.id);
}

/** The click a posted form names, or null when it names none that can be read. */
export function parseClick(get: FormGetter): TaxonomyClick | null {
  const [action, kind, id] = splitOp(formText(get, 'op'), 80, 3) ?? [];
  const parsed = TaxonomyClickSchema.safeParse({ action, kind, id });
  return parsed.success ? parsed.data : null;
}

// ---- Where each outcome goes ----

export const taxonomyNoticeCodes = [
  'added',
  'renamed',
  'moved',
  'retired',
  'restored',
  'unchanged',
  'stale',
  'last_active',
  'slug_taken',
  'name_taken',
  'list_full',
  'invalid',
] as const;
export type TaxonomyNoticeCode = (typeof taxonomyNoticeCodes)[number];
export const taxonomyNotices = copy.notices;

/** The save's answer as far as the redirect needs it: the data layer's result fits this shape. */
export type TaxonomySaveResult =
  | {
      status: 'saved';
      done: 'added' | 'renamed' | 'moved' | 'retired' | 'restored';
    }
  | { status: 'unchanged' }
  | {
      status: 'refused';
      reason:
        'stale' | 'last_active' | 'slug_taken' | 'name_taken' | 'list_full';
    };

/** The notice code of a save's answer. */
export function noticeCodeFor(result: TaxonomySaveResult): TaxonomyNoticeCode {
  if (result.status === 'saved') return result.done;
  return result.status === 'unchanged' ? 'unchanged' : result.reason;
}

const fieldOfRefusal = {
  slug_taken: ['slug'],
  name_taken: ['name'],
} as const;

/**
 * Where a notice sends the editor. A refusal of a form's own field goes back to that form with the
 * field to look at; everything else shows on the lists.
 */
export function taxonomyRedirect(
  form: string | null,
  code: TaxonomyNoticeCode,
  fields: readonly TaxonomyFormField[] = [],
): string {
  if (form !== null && (code === 'invalid' || code in fieldOfRefusal)) {
    const named =
      code === 'invalid'
        ? fields
        : fieldOfRefusal[code as keyof typeof fieldOfRefusal];
    return noticeHref(form, code, named);
  }
  return noticeHref(taxonomyPath, code);
}

// ---- What the pages show ----

export type TaxonomyRow = {
  id: string;
  name: string;
  slug: string;
  retired: boolean;
  stateLabel: string;
  stateTone: StatusTone;
  canMoveUp: boolean;
  canMoveDown: boolean;
  moveUpValue: string;
  moveDownValue: string;
  /** Retire, or bring back a retired term. */
  switchLabel: string;
  switchValue: string;
  /** False for the last term that is not retired: the lib's rule, shown as a disabled button and a line of text. */
  canSwitch: boolean;
  renameHref: string;
};

export function buildTaxonomyRows(
  kind: TaxonomyKind,
  terms: readonly TaxonomyTerm[],
): TaxonomyRow[] {
  const last = terms.length - 1;
  return terms.map((term, place) => {
    const retired = term.retiredAt !== null;
    const switchAction = retired ? 'restore' : 'retire';
    const click = (action: TaxonomyClick['action']) =>
      clickValue({ action, kind, id: term.id });
    return {
      id: term.id,
      name: term.name,
      slug: term.slug,
      retired,
      stateLabel: retired ? copy.states.retired : copy.states.active,
      stateTone: retired ? 'neutral' : 'success',
      canMoveUp: place > 0,
      canMoveDown: place < last,
      moveUpValue: click('up'),
      moveDownValue: click('down'),
      switchLabel: copy.actions[switchAction],
      switchValue: click(switchAction),
      canSwitch:
        decideClick(terms, { action: switchAction, id: term.id }).status ===
        'apply',
      renameHref: renamePath(kind, term.id),
    };
  });
}

/** The term an address names, or null for an id that is none of that list's. */
export function findTerm(
  terms: readonly TaxonomyTerm[],
  rawId: string,
): TaxonomyTerm | null {
  const id = parseIdField(rawId);
  return terms.find((term) => term.id === id) ?? null;
}
