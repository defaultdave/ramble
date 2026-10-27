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
 * Whether every key and string in a JSON value is storable. Iterative, and linear in the size of
 * the value, which the callers have already bounded.
 */
export function isStorableJson(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      if (!isStorable(current)) return false;
    } else if (Array.isArray(current)) {
      pending.push(...(current as unknown[]));
    } else if (typeof current === 'object' && current !== null) {
      for (const [key, child] of Object.entries(current)) {
        if (!isStorable(key)) return false;
        pending.push(child);
      }
    }
  }
  return true;
}

/**
 * Text counted in characters the way Postgres counts them (a code point is one, where
 * `String.length` counts an emoji as two), and refused when it holds something Postgres cannot
 * store. The cheap length check runs first so the code-point walk never sees a huge input.
 */
function boundedText(max: number) {
  return z
    .string()
    .max(max * 2)
    .refine((value) => Array.from(value).length <= max, {
      message: `At most ${String(max)} characters`,
    })
    .refine(isStorable, {
      message: 'Contains a character that cannot be stored',
    });
}

const notBlank = (value: string) => /\S/.test(value);

export function requiredText(max: number) {
  return boundedText(max).refine(notBlank, { message: 'Must not be blank' });
}

export function optionalText(max: number) {
  return requiredText(max).nullable();
}
