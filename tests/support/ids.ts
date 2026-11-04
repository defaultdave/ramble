/** A well-formed UUID built from a number, so a fixture's IDs are readable and distinct. */
export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
