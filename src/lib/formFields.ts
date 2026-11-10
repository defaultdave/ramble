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
