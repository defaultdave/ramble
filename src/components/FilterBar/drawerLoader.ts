/**
 * The filter drawer brings the dialog machinery with it, which a guest who never opens it should not
 * download, so it is fetched when it is first wanted. A failed fetch rejects and a later call tries again.
 */
export function loadDrawer() {
  return import('@/components/FilterDrawer').then(
    ({ FilterDrawer }) => FilterDrawer,
  );
}
