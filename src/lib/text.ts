import { z } from 'zod';

/**
 * Whether Postgres can store this string: it refuses U+0000 in text and jsonb, and a lone
 * surrogate cannot be encoded as UTF-8 or written as a JSON escape. A write that reaches the
 * database with either throws an error whose message carries the SQL and the bound values.
 */
export function isStorable(value: string): boolean {
  return !value.includes('\u0000') && value.isWellFormed();
}

/**
 * Calls `visit` on a JSON value and on every key, string, and child inside it, and stops at the
 * first `false`. Iterative, so a wide or deep value cannot overflow the stack, and linear in the
 * size of the value, which the callers have already bounded.
 */
export function everyJsonNode(
  value: unknown,
  visit: (node: unknown) => boolean,
): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!visit(current)) return false;
    if (Array.isArray(current)) {
      for (const child of current as unknown[]) pending.push(child);
    } else if (typeof current === 'object' && current !== null) {
      for (const [key, child] of Object.entries(current)) {
        if (!visit(key)) return false;
        pending.push(child);
      }
    }
  }
  return true;
}

/** Whether every key and string in a JSON value is storable. */
export function isStorableJson(value: unknown): boolean {
  return everyJsonNode(
    value,
    (node) => typeof node !== 'string' || isStorable(node),
  );
}

/**
 * Text counted in characters the way Postgres counts them (a code point is one, where
 * `String.length` counts an emoji as two), and refused when it holds something Postgres cannot
 * store. Zod runs every refinement even after `.max()` has failed, so each refinement checks the
 * length in UTF-16 units first (a code point is at most two) and only then walks the string: a
 * string over the limit is refused without being walked.
 */
function boundedText(max: number) {
  const fits = (value: string) => value.length <= max * 2;
  return z
    .string()
    .max(max * 2)
    .refine((value) => fits(value) && Array.from(value).length <= max, {
      message: `At most ${String(max)} characters`,
    })
    .refine((value) => !fits(value) || isStorable(value), {
      message: 'Contains a character that cannot be stored',
    });
}

/**
 * Every character JavaScript's `\s` matches, spelled out so the same class can be handed to
 * Postgres, whose `[[:space:]]` differs (it takes U+00A0 and U+FEFF as text). The database CHECKs
 * use `notBlankPattern` too, so a value is blank in Zod exactly when it is blank in the database.
 */
const whitespaceClass = String.raw`\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff`;
export const notBlankPattern = `[^${whitespaceClass}]`;
const notBlankRegex = new RegExp(notBlankPattern);

const notBlank = (value: string) => notBlankRegex.test(value);

export function requiredText(max: number) {
  return boundedText(max).refine(notBlank, { message: 'Must not be blank' });
}

export function optionalText(max: number) {
  return requiredText(max).nullable();
}
