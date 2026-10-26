export type RouteGroup = 'guest' | 'checkout' | 'host' | 'ops';

export type RouteRow = {
  path: string;
  group: RouteGroup;
  heading: string;
  noindex: boolean;
};

export const routes: readonly RouteRow[] = [
  { path: '/', group: 'guest', heading: 'Ramble', noindex: false },
  {
    path: '/new-york/browse',
    group: 'guest',
    heading: 'Browse',
    noindex: false,
  },
  {
    path: '/new-york/things-to-do/sample',
    group: 'guest',
    heading: 'Category',
    noindex: false,
  },
  {
    path: '/new-york/neighborhoods/sample',
    group: 'guest',
    heading: 'Neighborhood',
    noindex: false,
  },
  {
    path: '/experiences/sample',
    group: 'guest',
    heading: 'Experience',
    noindex: false,
  },
  {
    path: '/guide/sample',
    group: 'guest',
    heading: 'Guide entry',
    noindex: false,
  },
  {
    path: '/picks/sample',
    group: 'guest',
    heading: 'Ramble Picks',
    noindex: false,
  },
  { path: '/gifts', group: 'guest', heading: 'Gift guide', noindex: false },
  { path: '/help', group: 'guest', heading: 'Help', noindex: false },
  { path: '/legal/sample', group: 'guest', heading: 'Legal', noindex: false },
  {
    path: '/accessibility',
    group: 'guest',
    heading: 'Accessibility',
    noindex: false,
  },
  { path: '/contact', group: 'guest', heading: 'Contact', noindex: false },
  {
    path: '/checkout/sample',
    group: 'checkout',
    heading: 'Checkout',
    noindex: true,
  },
  {
    path: '/gifts/checkout/sample',
    group: 'checkout',
    heading: 'Gift checkout',
    noindex: true,
  },
  {
    path: '/orders/sample',
    group: 'checkout',
    heading: 'Order confirmation',
    noindex: true,
  },
  {
    path: '/manage/sample',
    group: 'checkout',
    heading: 'Manage booking',
    noindex: true,
  },
  {
    path: '/gift/sample',
    group: 'checkout',
    heading: 'Redeem a gift',
    noindex: true,
  },
  { path: '/host', group: 'host', heading: 'Host tools', noindex: true },
  { path: '/ops', group: 'ops', heading: 'Operations', noindex: true },
];

export const unknownPaths: Record<RouteGroup, string> = {
  guest: '/this/page/does/not/exist',
  checkout: '/checkout/sample/unknown',
  host: '/host/unknown',
  ops: '/ops/unknown',
};

/**
 * Route groups that render per request so every script carries the CSP nonce. Their
 * not-found page renders inside a resumed render, which cannot change the status, so an
 * unknown path there answers 200; the cached guest group keeps its static 404.
 */
export const perRequestGroups: ReadonlySet<RouteGroup> = new Set([
  'checkout',
  'host',
  'ops',
]);

export function unknownPathStatus(group: RouteGroup): number {
  return perRequestGroups.has(group) ? 200 : 404;
}

/**
 * Under each per-request prefix, the bare path and a path deeper than any page. Each must
 * render that group's own not-found page per request, never the guest group's prerendered shell.
 */
export const perRequestFallbackPaths: readonly string[] = [
  '/checkout',
  '/checkout/sample/a/b',
  '/manage',
  '/manage/sample/a/b',
  '/orders',
  '/orders/sample/a/b',
  '/gift',
  '/gift/sample/a/b',
  '/gifts/checkout',
  '/gifts/checkout/sample/a/b',
  '/host/a/b/c',
  '/ops/a/b/c',
];

export const notFoundHeading = "We can't find that page";

export const unprerenderedParamPath = '/picks/not-prerendered';

export function expectedTitle(heading: string): string {
  return heading === 'Ramble' ? heading : `${heading} | Ramble`;
}
