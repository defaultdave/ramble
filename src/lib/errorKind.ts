/**
 * The name of an error's kind, the only part of a caught error that is safe to log: the message and
 * the cause of a driver or network error can carry the query, its values, or connection details.
 * The fallback names a thrown value that is not an Error; callers keep their own so the log values
 * they already emit do not change.
 */
export function errorKind(error: unknown, fallback = 'unknown'): string {
  return error instanceof Error ? error.name : fallback;
}
