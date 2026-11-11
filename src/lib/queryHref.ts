/** A path with its query: `path?name=value&...` from pairs, so a name may repeat, and the bare path when there are none. */
export function hrefWithQuery(
  path: string,
  entries: readonly (readonly [name: string, value: string])[],
): string {
  const query = new URLSearchParams(
    entries.map(([name, value]) => [name, value]),
  ).toString();
  return query ? `${path}?${query}` : path;
}
