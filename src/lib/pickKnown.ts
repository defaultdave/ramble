/** The allowed value that `raw` names, or the fallback when it names none of them. */
export function pickKnown<T extends string, F>(
  raw: string | null | undefined,
  allowed: readonly T[],
  fallback: F,
): T | F {
  return allowed.find((known) => known === raw) ?? fallback;
}
