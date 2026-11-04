/**
 * The fixed addresses the site chrome links to. Kept apart from `routes` because that module
 * reaches the catalog schemas, which a client module must not load.
 */

/** The browse page. The grammar of its query lives in `filters.ts`. */
export const browsePath = '/new-york/browse';

/** The id of the first Ramble Picks module, which the header and footer link to. */
export const picksAnchor = 'picks';

/** The home page at its Ramble Picks module. */
export const homePicksHref = `/#${picksAnchor}`;

export const giftGuidePath = '/gifts';

export const contactPath = '/contact';
export const helpPath = '/help';
export const accessibilityPath = '/accessibility';

export const legalPath = (doc: 'terms' | 'privacy') => `/legal/${doc}`;
