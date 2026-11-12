import type { AlertTone } from './alertTone';
import { slugify, WriteIdSchema } from './catalog';
import { pickKnown } from './pickKnown';
import { tableHref } from './tableQuery';

// What the ops forms share: reading a posted form, and the redirect-with-a-notice that every ops
// action ends in. Each form passes its own field list or notice codes.

/** How a form is read: a posted FormData's `get`, or a map in a test. */
export type FormGetter = (name: string) => unknown;

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
