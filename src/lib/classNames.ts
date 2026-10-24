// CSS Module lookups are typed `string | undefined` under noUncheckedIndexedAccess.
export function classNames(
  ...names: (string | false | null | undefined)[]
): string {
  return names.filter(Boolean).join(' ');
}
