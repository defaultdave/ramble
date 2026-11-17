import { opsEditorialSectionsCopy } from './copy/opsEditorialSections';
import {
  HomeModulesInputSchema,
  RichTextInputSchema,
  editorialLimits,
  picksOf,
  homeModuleKinds,
  type Collection,
  type HomeModule,
  type HomeModulesInput,
} from './editorial';
import { editorialPath } from './editorialAdmin';
import {
  fieldsFromIssues,
  formHas,
  formJson,
  formText,
  noticeHref,
  opValue,
  oversizedFields,
  rawFormFieldLimit,
  splitOp,
  swapAt,
  parseIdField,
  type FormGetter,
} from './opsForm';
import { pickKnown } from './pickKnown';
import { docOrNull } from './richText/paragraphs';
import type { RichTextDoc } from './richText/format';
import type { StatusTone } from './statusBadge';
import { wholeNumberPattern } from './text';

// The ops home page modules (PRD-3, 50): staff reorder the modules, switch them on and off, and
// edit each one's heading, text and Pick. The gift guide module is carried through every save
// unchanged and has no controls here.

const copy = opsEditorialSectionsCopy.home;

export const homePath = `${editorialPath}/home`;
export const homeModulePath = (position: number | string) =>
  `${homePath}/${String(position)}`;

export type HomeModuleKind = (typeof homeModuleKinds)[number];
type ModuleInput = HomeModulesInput[number];

/** The gift guide module belongs to the gift guide, which has no editor in this area. */
function isManagedElsewhere(kind: HomeModuleKind): boolean {
  return kind === 'gift_guide';
}

export const homeModuleFieldNames = [
  'heading',
  'body',
  'collectionId',
] as const;
export type HomeModuleField = (typeof homeModuleFieldNames)[number];

/** Which of a module's settings the guest page reads for its kind, so the editor shows those and no others. */
export function homeModuleFields(
  kind: HomeModuleKind,
): readonly HomeModuleField[] {
  switch (kind) {
    case 'hero_search':
      return ['heading', 'body'];
    case 'picks':
      return ['heading', 'collectionId'];
    case 'category_rail':
    case 'this_week':
      return ['heading'];
    case 'gift_guide':
    case 'reassurance':
      return [];
  }
}

/** The modules as the save takes them: the stored list without ids and positions, the position being the index. */
export function toHomeModulesInput(
  stored: readonly HomeModule[],
): HomeModulesInput {
  return stored.map(({ kind, enabled, heading, collectionId, body }) => ({
    kind,
    enabled,
    heading,
    collectionId,
    body,
  }));
}

// ---- Buttons on the list: move, turn on, turn off ----

const opActions = ['up', 'down', 'enable', 'disable'] as const;
type HomeModuleAction = (typeof opActions)[number];

/** A click on the list. The module's kind rides along so a stale page cannot move a different module. */
export type HomeModuleOp = {
  action: HomeModuleAction;
  position: number;
  kind: HomeModuleKind;
};

/** What a list button posts: the action, the place and the kind of the module it was drawn for. */
function homeModuleOpValue(
  action: HomeModuleAction,
  position: number,
  kind: HomeModuleKind,
): string {
  return opValue(action, position, kind);
}

/** The click a posted form names, or null when it names none that can be read. */
export function parseHomeModuleOp(get: FormGetter): HomeModuleOp | null {
  const [action, place, kind] = splitOp(formText(get, 'op'), 40, 3) ?? [];
  const known = pickKnown(action, opActions, null);
  const knownKind = pickKnown(kind, homeModuleKinds, null);
  if (
    known === null ||
    knownKind === null ||
    place === undefined ||
    !wholeNumberPattern.test(place)
  ) {
    return null;
  }
  return { action: known, position: Number(place), kind: knownKind };
}

type HomeDone = 'moved' | 'enabled' | 'disabled' | 'saved';

export type AppliedHome =
  | { status: 'changed'; modules: HomeModulesInput; done: HomeDone }
  | { status: 'stale' }
  | { status: 'managed_elsewhere' };

const doneByAction = {
  up: 'moved',
  down: 'moved',
  enable: 'enabled',
  disable: 'disabled',
} as const satisfies Record<HomeModuleAction, HomeDone>;

/**
 * What a click does to the stored list. A click drawn for a module that is no longer at that place
 * or already has that state changes nothing (`stale`). The gift guide module cannot be switched.
 */
export function applyHomeModuleOp(
  modules: HomeModulesInput,
  op: HomeModuleOp,
): AppliedHome {
  const target = modules[op.position];
  if (target?.kind !== op.kind) return { status: 'stale' };
  const done = doneByAction[op.action];
  if (op.action === 'enable' || op.action === 'disable') {
    if (isManagedElsewhere(target.kind)) return { status: 'managed_elsewhere' };
    const enabled = op.action === 'enable';
    if (target.enabled === enabled) return { status: 'stale' };
    return {
      status: 'changed',
      done,
      modules: modules.map((module, index) =>
        index === op.position ? { ...module, enabled } : module,
      ),
    };
  }
  const to = op.action === 'up' ? op.position - 1 : op.position + 1;
  const moved = swapAt(modules, op.position, to);
  if (moved === null) return { status: 'stale' };
  return { status: 'changed', done, modules: moved };
}

// ---- The edit form ----

export type HomeModuleEdit = {
  position: number;
  kind: HomeModuleKind;
  enabled: boolean;
  heading: string | null;
  body: RichTextDoc | null;
  collectionId: string | null;
};

export type HomeModuleForm =
  | { ok: true; value: HomeModuleEdit }
  | { ok: false; position: number; fields: HomeModuleField[] };

/**
 * The posted edit form. A form that does not name a module is `null`. A field too long to be read
 * is refused unread. The editor only posts the fields its kind shows, and `applyHomeModuleEdit`
 * leaves the others as stored.
 */
export function parseHomeModuleForm(get: FormGetter): HomeModuleForm | null {
  const place = formText(get, 'position');
  const kind = pickKnown(formText(get, 'kind'), homeModuleKinds, null);
  if (place === undefined || !wholeNumberPattern.test(place) || kind === null) {
    return null;
  }
  const oversized: readonly string[] = [
    ...oversizedFields(get, ['heading'], rawFormFieldLimit),
    ...oversizedFields(get, ['body'], editorialLimits.richTextStoredBytes),
  ];
  if (oversized.length > 0) {
    return {
      ok: false,
      position: Number(place),
      fields: homeModuleFieldNames.filter((f) => oversized.includes(f)),
    };
  }
  const posted = formJson(get, 'body');
  const body = RichTextInputSchema.nullable().safeParse(
    posted === undefined ? null : posted,
  );
  if (!body.success) {
    return { ok: false, position: Number(place), fields: ['body'] };
  }
  const collection = formText(get, 'collectionId');
  const collectionId =
    collection === undefined ? null : parseIdField(collection);
  if (collection !== undefined && collectionId === null) {
    return { ok: false, position: Number(place), fields: ['collectionId'] };
  }
  return {
    ok: true,
    value: {
      position: Number(place),
      kind,
      enabled: formHas(get, 'enabled'),
      heading: formText(get, 'heading') ?? null,
      body: docOrNull(body.data),
      collectionId,
    },
  };
}

export type AppliedEdit =
  AppliedHome | { status: 'invalid'; fields: HomeModuleField[] };

/** The stored list with the edit applied to the settings its kind shows; the list is checked as the save will check it. */
export function applyHomeModuleEdit(
  modules: HomeModulesInput,
  edit: HomeModuleEdit,
): AppliedEdit {
  const target = modules[edit.position];
  if (target?.kind !== edit.kind) return { status: 'stale' };
  if (isManagedElsewhere(target.kind)) return { status: 'managed_elsewhere' };
  const shown = homeModuleFields(target.kind);
  const next: ModuleInput = {
    ...target,
    enabled: edit.enabled,
    heading: shown.includes('heading') ? edit.heading : target.heading,
    body: shown.includes('body') ? edit.body : target.body,
    collectionId: shown.includes('collectionId')
      ? edit.collectionId
      : target.collectionId,
  };
  const edited = modules.map((module, index) =>
    index === edit.position ? next : module,
  );
  const checked = HomeModulesInputSchema.safeParse(edited);
  if (!checked.success) {
    return {
      status: 'invalid',
      fields: fieldsFromIssues(
        checked.error.issues.filter((issue) => issue.path[0] === edit.position),
        homeModuleFieldNames,
        (path) => path[1],
      ),
    };
  }
  return { status: 'changed', modules: edited, done: 'saved' };
}

// ---- Where each outcome goes ----

export const homeNoticeCodes = [
  'moved',
  'enabled',
  'disabled',
  'saved',
  'stale',
  'managed_elsewhere',
  'unknown_collection',
  'collection_kind_mismatch',
  'invalid',
] as const;
export const homeNotices = copy.notices;

/** The save's answer as far as the redirect needs it: the data layer's result fits this shape. */
export type HomeSaveResult = {
  status: 'saved' | 'unknown_collection' | 'collection_kind_mismatch';
};

export type HomeOutcome =
  | { status: HomeDone }
  | { status: 'stale' | 'managed_elsewhere' }
  | { status: 'unknown_collection' | 'collection_kind_mismatch' }
  | { status: 'invalid'; fields: readonly HomeModuleField[] };

/** What the action did with a click or an edit, from what it applied and what the save answered. */
export function homeOutcomeFor(
  applied: AppliedEdit,
  saved: HomeSaveResult | undefined,
): HomeOutcome {
  if (applied.status !== 'changed') return applied;
  if (saved === undefined) throw new Error('A changed list was not saved');
  return saved.status === 'saved'
    ? { status: applied.done }
    : { status: saved.status };
}

/** Where an outcome sends the editor: the list, or for a refusal of an edit the form it came from. */
export function homeRedirect(
  editing: number | null,
  outcome: HomeOutcome,
): string {
  const form = editing === null ? homePath : homeModulePath(editing);
  switch (outcome.status) {
    case 'invalid':
      return noticeHref(form, 'invalid', outcome.fields);
    case 'unknown_collection':
    case 'collection_kind_mismatch':
      return editing === null
        ? noticeHref(homePath, outcome.status)
        : noticeHref(form, outcome.status, ['collectionId']);
    default:
      return noticeHref(homePath, outcome.status);
  }
}

// ---- What the pages show ----

/** The module at the place an address names, when it has settings to edit here; none for a bad place, an empty one, or a module with no editor. */
export function editableModule(
  modules: readonly HomeModule[],
  place: string,
): HomeModule | null {
  if (!wholeNumberPattern.test(place)) return null;
  const found = modules[Number(place)];
  if (found === undefined) return null;
  return !isManagedElsewhere(found.kind) &&
    homeModuleFields(found.kind).length > 0
    ? found
    : null;
}

export type HomeModuleRow = {
  position: number;
  kind: HomeModuleKind;
  label: string;
  enabled: boolean;
  stateLabel: string;
  stateTone: StatusTone;
  /** The heading it shows, or the Pick it points at; empty when it uses the standard copy. */
  detail: string;
  editable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canSwitch: boolean;
  moveUpValue: string;
  moveDownValue: string;
  switchLabel: string;
  switchValue: string;
};

export function buildHomeModuleRows(
  modules: readonly HomeModule[],
  collections: readonly Pick<Collection, 'id' | 'title'>[],
): HomeModuleRow[] {
  const titles = new Map(collections.map(({ id, title }) => [id, title]));
  const last = modules.length - 1;
  return modules.map((module, position) => {
    const managed = isManagedElsewhere(module.kind);
    const switchAction = module.enabled ? 'disable' : 'enable';
    const pick =
      module.collectionId === null
        ? undefined
        : titles.get(module.collectionId);
    return {
      position,
      kind: module.kind,
      label: copy.kinds[module.kind],
      enabled: module.enabled,
      stateLabel: module.enabled ? copy.states.on : copy.states.off,
      stateTone: module.enabled ? 'success' : 'neutral',
      detail: managed
        ? copy.managedElsewhere
        : [module.heading ?? copy.noHeading, pick]
            .filter((part) => part !== undefined)
            .join(' · '),
      editable: !managed && homeModuleFields(module.kind).length > 0,
      canMoveUp: position > 0,
      canMoveDown: position < last,
      canSwitch: !managed,
      moveUpValue: homeModuleOpValue('up', position, module.kind),
      moveDownValue: homeModuleOpValue('down', position, module.kind),
      switchLabel: copy.actions[switchAction],
      switchValue: homeModuleOpValue(switchAction, position, module.kind),
    };
  });
}

/** The Picks a module can point at, labelled with their status, for the editor's list. */
export function pickOptions(
  collections: readonly Pick<Collection, 'id' | 'title' | 'kind' | 'status'>[],
): { value: string; label: string }[] {
  return picksOf(collections).map(({ id, title, status }) => ({
    value: id,
    label: status === 'draft' ? `${title}${copy.fields.draftSuffix}` : title,
  }));
}

export const homeFieldProblems = {
  heading: copy.problems.heading(editorialLimits.heading),
  body: copy.problems.body,
  collectionId: copy.problems.collectionId,
} satisfies Record<HomeModuleField, string>;
