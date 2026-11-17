import type { z } from 'zod';

/**
 * Reads a form's text fields. A file or a missing field reads as empty. A value past `maxChars` is
 * cut to one character over, so the schema still refuses it and the guest sees the field's error
 * rather than a silently emptied field.
 */
export function readTextFields<Field extends string>(
  fields: readonly Field[],
  get: (field: Field) => unknown,
  maxChars: number,
): Record<Field, string> {
  const values = {} as Record<Field, string>;
  for (const field of fields) {
    const raw = get(field);
    values[field] = typeof raw === 'string' ? raw.slice(0, maxChars + 1) : '';
  }
  return values;
}

/** The reply a guarded form gives back: what the guest typed rides along so a refused form comes back as it was sent. */
export type GuardedFormState<Values, Errors> =
  | { status: 'idle' }
  | { status: 'sent' }
  | { status: 'invalid'; values: Values; errors: Errors }
  | { status: 'rate_limited'; values: Values }
  | { status: 'expired'; values: Values }
  | { status: 'failed'; values: Values };

/**
 * One message per field the schema refused, in the words the form shows. `fieldOfKey` maps a schema
 * key to its form field, so a schema that names a field differently still lands on the right one;
 * a key it does not list is skipped.
 */
export function fieldErrorsFrom<Field extends string>(
  error: z.ZodError,
  fieldOfKey: Readonly<Record<string, Field>>,
  messages: Readonly<Record<Field, string>>,
): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== 'string' || !Object.hasOwn(fieldOfKey, key)) continue;
    const field = fieldOfKey[key];
    if (field !== undefined) errors[field] ??= messages[field];
  }
  return errors;
}
