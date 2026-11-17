import { z } from 'zod';
import { opsEditorialSectionsCopy } from './copy/opsEditorialSections';
import { EntityIdSchema } from './catalog';
import { experienceStatuses } from './catalog';
import {
  CollectionInputSchema,
  editorialLimits,
  type Collection,
  type CollectionInput,
  type CollectionItem,
} from './editorial';
import {
  editorialPath,
  entryStatusLabels,
  entryStatusTones,
  statusAfter,
  type EntryIntent,
  type PublishStatus,
} from './editorialAdmin';
import { experienceStatusLabels } from './experienceEditor';
import {
  fieldsFromIssues,
  formJson,
  formText,
  noticeHref,
  oversizedFields,
  parseIdField,
  slugFor,
  type FormGetter,
} from './opsForm';
import { pickKnown } from './pickKnown';
import { docOrNull } from './richText/paragraphs';
import { defaultHostTimeZone } from './hostSetup';
import { zonedDeadlineLabel } from './zonedLabels';
import { wholeNumberPattern } from './text';

// The ops Ramble Picks collections (PRD-4, 50): a title, address, summary and introduction that
// staff save as a draft, publish or take down, and an ordered list of experiences. The gift guide
// has no editor in this area, so every read here is of Picks only.

const copy = opsEditorialSectionsCopy.collections;

export const collectionsPath = `${editorialPath}/collections`;
export const newCollectionPath = `${collectionsPath}/new`;
export const collectionPath = (id: string) => `${collectionsPath}/${id}`;

export {
  entryStatusLabels as collectionStatusLabels,
  entryStatusTones as collectionStatusTones,
};

/** The most experiences a read of choices returns, so the picker cannot grow with the catalog. */
export const experienceChoiceLimit = 500;

export const ExperienceChoiceSchema = z.object({
  id: EntityIdSchema,
  name: z.string(),
  status: z.enum(experienceStatuses),
});
export type ExperienceChoice = z.infer<typeof ExperienceChoiceSchema>;

type PickCollection = Collection & { kind: 'pick' };

/** The Picks among the collections read, in the order read. */
export function picksOf(collections: readonly Collection[]): PickCollection[] {
  return collections.filter(
    (collection): collection is PickCollection => collection.kind === 'pick',
  );
}

/** The Pick with this id, or none for a missing id or a collection of another kind. */
export function findPick(
  collections: readonly Collection[],
  id: string,
): PickCollection | null {
  return picksOf(collections).find((pick) => pick.id === id) ?? null;
}

// ---- The details form ----

export const collectionFormFields = [
  'title',
  'slug',
  'summary',
  'intro',
] as const;
export type CollectionFormField = (typeof collectionFormFields)[number];

export const collectionFieldProblems = {
  title: copy.problems.title(editorialLimits.title),
  slug: copy.problems.slug,
  summary: copy.problems.summary(editorialLimits.summary),
  intro: copy.problems.intro,
} satisfies Record<CollectionFormField, string>;

const collectionIntents = [
  'save',
  'publish',
  'unpublish',
] as const satisfies readonly EntryIntent[];

export type CollectionDetails = {
  id: string | undefined;
  slug: string;
  title: string;
  summary: string | null;
  intro: Collection['intro'];
  intent: EntryIntent;
};

export type CollectionForm =
  | { ok: true; value: CollectionDetails }
  | { ok: false; fields: CollectionFormField[] };

const rawFieldLimit = 1000;

/**
 * The posted details form. A blank address keeps the one the Pick has, or is made from the title
 * for a new one. The status the buttons mean is settled later against the stored row. A refused
 * form names the fields to look at and changes nothing.
 */
export function parseCollectionForm(get: FormGetter): CollectionForm {
  const oversized: readonly string[] = [
    ...oversizedFields(get, ['title', 'slug', 'summary'], rawFieldLimit),
    ...oversizedFields(get, ['intro'], editorialLimits.richTextStoredBytes),
  ];
  if (oversized.length > 0) {
    return {
      ok: false,
      fields: collectionFormFields.filter((f) => oversized.includes(f)),
    };
  }
  const intent = pickKnown(formText(get, 'intent'), collectionIntents, null);
  if (intent === null) return { ok: false, fields: [] };
  const id = parseIdField(get('id')) ?? undefined;
  const slug =
    slugFor(
      formText(get, 'title') ?? '',
      formText(get, 'slug') ??
        (id === undefined ? undefined : formText(get, 'currentSlug')),
      true,
      editorialLimits.slug,
    ) ?? undefined;
  const parsed = CollectionInputSchema.safeParse({
    id,
    kind: 'pick',
    slug,
    title: formText(get, 'title'),
    summary: formText(get, 'summary') ?? null,
    intro: formJson(get, 'intro') ?? null,
    status: 'draft',
    items: [],
  });
  if (!parsed.success) {
    return {
      ok: false,
      fields: fieldsFromIssues(parsed.error.issues, collectionFormFields),
    };
  }
  const { slug: okSlug, title, summary, intro } = parsed.data;
  return {
    ok: true,
    value: {
      id,
      slug: okSlug,
      title,
      summary,
      intro: docOrNull(intro),
      intent,
    },
  };
}

export type SettledCollection =
  | { status: 'ready'; input: CollectionInput }
  | { status: 'not_found' | 'no_entries' };

/**
 * The input a save writes. An existing Pick takes its status and entries from the stored row, not
 * the form, so a stale tab saving a draft cannot unpublish what another tab published and cannot
 * drop entries it never showed. A Pick with no entries cannot be published. A missing Pick, or one
 * of another kind, is `not_found` for everyone alike.
 */
export function settleCollection(
  details: CollectionDetails,
  stored: Collection | null,
): SettledCollection {
  if (details.id !== undefined && (stored === null || stored.kind !== 'pick')) {
    return { status: 'not_found' };
  }
  const current: PublishStatus = stored?.status ?? 'draft';
  const status = statusAfter(details.intent, current);
  const items = stored?.items ?? [];
  if (status === 'published' && items.length === 0) {
    return { status: 'no_entries' };
  }
  return {
    status: 'ready',
    input: {
      ...(stored ? { id: stored.id } : {}),
      kind: 'pick',
      slug: details.slug,
      title: details.title,
      summary: details.summary,
      intro: details.intro,
      status,
      items: [...items],
    },
  };
}

// ---- The experience list ----

export type ItemOp =
  | { action: 'up' | 'down' | 'remove'; index: number; experienceId: string }
  | { action: 'add'; experienceId: string; note: string | null };

function itemOpValue(
  action: 'up' | 'down' | 'remove',
  index: number,
  experienceId: string,
): string {
  return `${action}:${String(index)}:${experienceId}`;
}

export type ItemForm =
  { ok: true; op: ItemOp } | { ok: false; fields: ItemFormField[] } | null;

/** The click a posted list form names. `null` when it names none that can be read. */
export function parseItemOp(get: FormGetter): ItemForm {
  const raw = formText(get, 'op');
  if (raw === undefined || raw.length > 60) return null;
  if (raw === 'add') {
    const experienceId = parseIdField(formText(get, 'experienceId'));
    if (experienceId === null) return { ok: false, fields: ['experienceId'] };
    const note = formText(get, 'note') ?? null;
    if (note !== null && note.length > editorialLimits.note) {
      return { ok: false, fields: ['note'] };
    }
    return { ok: true, op: { action: 'add', experienceId, note } };
  }
  const [action, place, experienceId, ...rest] = raw.split(':');
  const known = pickKnown(action, ['up', 'down', 'remove'] as const, null);
  const id = parseIdField(experienceId);
  if (
    known === null ||
    id === null ||
    place === undefined ||
    rest.length > 0 ||
    !wholeNumberPattern.test(place)
  ) {
    return null;
  }
  return {
    ok: true,
    op: { action: known, index: Number(place), experienceId: id },
  };
}

type ItemDone = 'entry_added' | 'entry_removed' | 'entry_moved';

export type AppliedItems =
  | { status: 'changed'; items: CollectionItem[]; done: ItemDone }
  | { status: 'entry_stale' | 'entry_listed' | 'list_full' };

/** What a click does to the stored list. A click drawn for an entry no longer at that place changes nothing. */
export function applyItemOp(
  items: readonly CollectionItem[],
  op: ItemOp,
): AppliedItems {
  if (op.action === 'add') {
    if (items.some((item) => item.experienceId === op.experienceId)) {
      return { status: 'entry_listed' };
    }
    if (items.length >= editorialLimits.collectionItems) {
      return { status: 'list_full' };
    }
    return {
      status: 'changed',
      done: 'entry_added',
      items: [...items, { experienceId: op.experienceId, note: op.note }],
    };
  }
  const target = items[op.index];
  if (target?.experienceId !== op.experienceId) {
    return { status: 'entry_stale' };
  }
  if (op.action === 'remove') {
    return {
      status: 'changed',
      done: 'entry_removed',
      items: items.filter((_, index) => index !== op.index),
    };
  }
  const to = op.action === 'up' ? op.index - 1 : op.index + 1;
  const neighbour = items[to];
  if (neighbour === undefined) return { status: 'entry_stale' };
  const moved = [...items];
  moved[op.index] = neighbour;
  moved[to] = target;
  return { status: 'changed', done: 'entry_moved', items: moved };
}

export type SettledItems =
  | { status: 'ready'; input: CollectionInput; done: ItemDone }
  | { status: 'not_found' | 'entry_stale' | 'entry_listed' | 'list_full' };

/** The input a click on the list saves: the stored Pick with its entries changed. A missing Pick, or one of another kind, is `not_found`. */
export function settleItems(
  stored: Collection | null,
  op: ItemOp,
): SettledItems {
  if (stored === null || stored.kind !== 'pick') {
    return { status: 'not_found' };
  }
  const applied = applyItemOp(stored.items, op);
  if (applied.status !== 'changed') return applied;
  return {
    status: 'ready',
    done: applied.done,
    input: inputWithItems(stored, applied.items),
  };
}

/** The Pick's input with its entries replaced; everything else is what is stored. */
function inputWithItems(
  stored: Collection,
  items: readonly CollectionItem[],
): CollectionInput {
  return {
    id: stored.id,
    kind: 'pick',
    slug: stored.slug,
    title: stored.title,
    summary: stored.summary,
    intro: stored.intro,
    status: stored.status,
    items: [...items],
  };
}

// ---- Where each outcome goes ----

export const collectionNoticeCodes = [
  'saved',
  'published',
  'unpublished',
  'slug_taken',
  'not_found',
  'no_entries',
  'unknown_experience',
  'entry_added',
  'entry_removed',
  'entry_moved',
  'entry_stale',
  'entry_listed',
  'list_full',
  'invalid',
] as const;
type CollectionNoticeCode = (typeof collectionNoticeCodes)[number];
export const collectionNotices = copy.notices;

/** The save's answer as far as the redirect needs it: the data layer's result fits this shape. */
export type CollectionSaveResult =
  | { status: 'saved'; value: { id: string } }
  | {
      status:
        'not_found' | 'slug_taken' | 'gift_guide_exists' | 'unknown_experience';
    };

type ReachedNotice = Exclude<CollectionNoticeCode, 'invalid'>;

export type CollectionOutcome =
  | { status: 'invalid'; fields: readonly string[] }
  | { status: ReachedNotice; id?: string };

const savedNoticeByIntent = {
  save: 'saved',
  publish: 'published',
  unpublish: 'unpublished',
} as const satisfies Record<EntryIntent, ReachedNotice>;

/** What the data layer's answer to a save comes to, with the notice the saved click earns. */
export function collectionOutcomeFor(
  result: CollectionSaveResult,
  done: ReachedNotice,
): CollectionOutcome {
  switch (result.status) {
    case 'saved':
      return { status: done, id: result.value.id };
    case 'gift_guide_exists':
    case 'not_found':
      return { status: 'not_found' };
    default:
      return { status: result.status };
  }
}

/** The notice a saved details form earns: what the button did, which is the point of the click. */
export function savedCollectionNotice(intent: EntryIntent): ReachedNotice {
  return savedNoticeByIntent[intent];
}

/** Where an outcome sends the editor: the Pick it came from, the form for a refusal of a new one, or the list for a Pick that is gone. */
export function collectionRedirect(
  postedId: string | null,
  outcome: CollectionOutcome,
): string {
  const here = postedId === null ? newCollectionPath : collectionPath(postedId);
  switch (outcome.status) {
    case 'invalid':
      return noticeHref(here, 'invalid', outcome.fields);
    case 'slug_taken':
      return noticeHref(here, 'slug_taken', ['slug']);
    case 'not_found':
      return noticeHref(collectionsPath, 'not_found');
    default:
      return noticeHref(
        outcome.id === undefined ? here : collectionPath(outcome.id),
        outcome.status,
      );
  }
}

// ---- What the pages show ----

export type CollectionRow = {
  id: string;
  title: string;
  slug: string;
  status: PublishStatus;
  entryCount: number;
  updatedLabel: string;
};

export function buildCollectionRows(
  collections: readonly Collection[],
): CollectionRow[] {
  return picksOf(collections).map((pick) => ({
    id: pick.id,
    title: pick.title,
    slug: pick.slug,
    status: pick.status,
    entryCount: pick.items.length,
    updatedLabel: zonedDeadlineLabel(pick.updatedAt, defaultHostTimeZone),
  }));
}

export type ItemRow = {
  index: number;
  experienceId: string;
  name: string;
  note: string | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  upValue: string;
  downValue: string;
  removeValue: string;
};

/** The entries in order with the experience's name, or a stand-in for one the read did not return. */
export function buildItemRows(
  items: readonly CollectionItem[],
  choices: readonly ExperienceChoice[],
): ItemRow[] {
  const names = new Map(choices.map(({ id, name }) => [id, name]));
  const last = items.length - 1;
  return items.map(({ experienceId, note }, index) => ({
    index,
    experienceId,
    name: names.get(experienceId) ?? copy.items.unknownName,
    note,
    canMoveUp: index > 0,
    canMoveDown: index < last,
    upValue: itemOpValue('up', index, experienceId),
    downValue: itemOpValue('down', index, experienceId),
    removeValue: itemOpValue('remove', index, experienceId),
  }));
}

/** The experiences not yet in the list, by name, with their status when guests cannot book them. */
export function addableOptions(
  items: readonly CollectionItem[],
  choices: readonly ExperienceChoice[],
): { value: string; label: string }[] {
  const listed = new Set(items.map((item) => item.experienceId));
  return choices
    .filter(({ id }) => !listed.has(id))
    .map(({ id, name, status }) => ({
      value: id,
      label:
        status === 'live'
          ? name
          : `${name}${copy.items.statusSuffix(experienceStatusLabels[status])}`,
    }));
}

export const itemFormFields = ['experienceId', 'note'] as const;

export const itemFieldProblems = {
  experienceId: copy.items.problems.experienceId,
  note: copy.items.problems.note(editorialLimits.note),
} satisfies Record<ItemFormField, string>;
export type ItemFormField = (typeof itemFormFields)[number];
