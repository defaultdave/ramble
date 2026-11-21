// Plain Node runs this directly (type stripping): no imports, no enums, no parameter properties.
const pgFields = [
  'code',
  'severity',
  'detail',
  'hint',
  'schema',
  'table',
  'column',
  'dataType',
  'constraint',
  'where',
  'position',
  'routine',
] as const;

/**
 * drizzle wraps the driver error in its own, so the Postgres message sits several `.cause` links
 * down. Prints every link with whichever Postgres fields it carries.
 */
export function formatMigrationError(error: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; current !== undefined && !seen.has(current); depth++) {
    seen.add(current);
    const indent = '  '.repeat(depth);
    if (!(current instanceof Error)) {
      lines.push(`${indent}${String(current)}`);
      break;
    }
    lines.push(`${indent}${current.name}: ${current.message}`);
    const fields = current as unknown as Record<string, unknown>;
    for (const field of pgFields) {
      const value = fields[field];
      if (value !== undefined && value !== null && value !== '') {
        lines.push(`${indent}  ${field}: ${String(value)}`);
      }
    }
    current = current.cause;
  }
  return lines.join('\n');
}
