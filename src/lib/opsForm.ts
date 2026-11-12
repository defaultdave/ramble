import type { AlertTone } from './alertTone';
import { slugify, WriteIdSchema } from './catalog';
import { pickKnown } from './pickKnown';
import { tableHref } from './tableQuery';

// What the ops forms share: reading a posted form, and the redirect-with-a-notice that every ops
// action ends in. Each form passes its own field list or notice codes.

/** How a form is read: a posted FormData's `get`, or a map in a test. */
export type FormGetter = (name: string) => unknown;

/** What reading a posted form comes to: the value it names, or nothing at all (a refused form changes nothing). */
export type FormResult<T> = { ok: true; value: T } | { ok: false };

/** A posted text field, trimmed; undefined when it is missing, not text, or blank. */
export function formText(get: FormGetter, name: string): string | undefined {
  const raw = get(name);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A checkbox is ticked when the form carries it with any value. */
export function formHas(get: FormGetter, name: string): boolean {
  const raw = get(name);
  return raw !== null && raw !== undefined;
}

/** The fields of `fields` that `failed` holds, in the list's order: the order the form shows them. */
export function inFieldOrder<F extends string>(
  fields: readonly F[],
  failed: ReadonlySet<F>,
): F[] {
  return fields.filter((field) => failed.has(field));
}

/**
 * The fields a schema's issues name, each once, in the list's order. An issue on a name outside the
 * list is not a form field and is left out. A form whose schema nests its fields says which name an
 * issue's path stands for with `nameOf`; by default it is the path's first key.
 */
export function fieldsFromIssues<F extends string>(
  issues: readonly { path: readonly PropertyKey[] }[],
  fields: readonly F[],
  nameOf: (path: readonly PropertyKey[]) => unknown = (path) => path[0],
): F[] {
  const named = new Set<F>();
  for (const issue of issues) {
    const field = pickKnown(String(nameOf(issue.path)), fields, null);
    if (field !== null) named.add(field);
  }
  return inFieldOrder(fields, named);
}

/** Which of `fields` differ between two values, in the list's order. Nothing differing means nothing is written. */
export function changedFields<F extends string>(
  fields: readonly F[],
  before: Readonly<Record<F, unknown>>,
  after: Readonly<Record<F, unknown>>,
): F[] {
  return fields.filter((field) => before[field] !== after[field]);
}

/** The sentence for a field the last try refused, or undefined when it was not refused. */
export function problemText<F extends string>(
  problems: readonly F[],
  texts: Readonly<Record<F, string>>,
  field: F,
): string | undefined {
  return problems.includes(field) ? texts[field] : undefined;
}

/** The props a form control takes for a refused field, to spread: its error text, or nothing. */
export function errorProps<F extends string>(
  problems: readonly F[],
  texts: Readonly<Record<F, string>>,
  field: F,
): { errorText: string } | { errorText?: never } {
  const errorText = problemText(problems, texts, field);
  return errorText === undefined ? {} : { errorText };
}

/** The fields whose posted text is over the limit, so no rule walks an unbounded string. */
export function oversizedFields<F extends string>(
  get: FormGetter,
  fields: readonly F[],
  limit: number,
): F[] {
  return fields.filter((field) => {
    const raw = get(field);
    return typeof raw === 'string' && raw.length > limit;
  });
}

/** A slug is typed or comes from the name, never repaired after the fact: a name that leaves none, or one too long, is refused. */
export function slugFor(
  name: string,
  typed: string | undefined,
  derive: boolean,
  maxLength: number,
): string | null {
  const slug = typed ?? (derive ? slugify(name) : '');
  return slug !== '' && slug.length <= maxLength ? slug : null;
}

/** The id a form carries for the row it edits, lower-cased, or null when it is not an id. */
export function parseIdField(raw: unknown): string | null {
  const parsed = WriteIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type NoticeText = { tone: AlertTone; title: string };

/** The notice a page address names among `codes`, or null for none, an unknown one, or a repeated one. */
export function parseNotice<C extends string>(
  raw: string | readonly string[] | undefined,
  codes: readonly C[],
): C | null {
  return typeof raw === 'string' ? pickKnown(raw, codes, null) : null;
}

/** The text of a notice, or null when there is none to show. */
export function noticeText<C extends string>(
  notices: Readonly<Record<C, NoticeText>>,
  code: C | null,
): NoticeText | null {
  return code === null ? null : notices[code];
}

/** The fields an address names as needing another look, in form order, and only those of `fields`. */
export function parseProblemFields<F extends string>(
  raw: string | readonly string[] | undefined,
  fields: readonly F[],
): F[] {
  const named = typeof raw === 'string' ? raw.split(',') : [];
  return fields.filter((field) => named.includes(field));
}

/** Where an action sends the person next: a path, a notice, and for a refused form the fields to look at. */
export function noticeHref(
  path: string,
  notice: string,
  fields: readonly string[] = [],
): string {
  return tableHref(path, { notice, fields: fields.join(',') });
}

/** The notice every refused ops form names, whichever form it was. */
export const invalidFormNotice = {
  tone: 'danger',
  title: 'Some details need another look.',
} as const satisfies NoticeText;

/** What sending an invite's sign-in link comes to; `not_found` is a person or row that is gone. */
export type InviteResult = 'sent' | 'rate_limited' | 'failed' | 'not_found';

/** The notice an invite action names for a result, from the codes its page uses for each. One mapper, so no page re-decides what a refused or failed link means. */
export function inviteNoticeFor<C extends string>(
  result: InviteResult,
  codes: Readonly<Record<InviteResult, C>>,
): C {
  return codes[result];
}

/** The notices every invite action shares, whoever is being invited. */
export const inviteFailureNotices = {
  invite_failed: {
    tone: 'danger',
    title: 'The sign-in link could not be sent. Try again in a moment.',
  },
  rate_limited: {
    tone: 'warning',
    title: 'Too many sign-in links went to this address. Try again later.',
  },
} as const satisfies Record<string, NoticeText>;
