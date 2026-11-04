/**
 * The generated name of a CSS module class, for asserting an element carries it. A class missing
 * from the module reads as undefined to the type checker, and asserting on undefined would pass
 * for any element, so a missing one throws here.
 */
export function moduleClass(name: string | undefined): string {
  if (!name) throw new Error('That class is not in the CSS module');
  return name;
}
