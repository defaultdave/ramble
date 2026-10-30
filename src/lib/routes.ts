import { EntityIdSchema, isSlug } from './catalog';

// ---- Browse ----

/** The browse page. The grammar of its query lives in `filters.ts`. */
export const browsePath = '/new-york/browse';

// ---- Experiences and the guide ----

/** The address of an experience page: `/experiences/[slug]-[id]`. */
export function experiencePath({ slug, id }: ExperienceAddress): string {
  return `/experiences/${slug}-${id}`;
}

/** The address of a guide entry: `/guide/[slug]-[id]`. */
export function guidePath({ slug, id }: ExperienceAddress): string {
  return `/guide/${slug}-${id}`;
}

/** A card links to the experience page, or to the guide entry when the experience is guide only. */
export function experienceCardPath(
  experience: ExperienceAddress & { status: string },
): string {
  return experience.status === 'guide_only'
    ? guidePath(experience)
    : experiencePath(experience);
}

/** A canonical uuid is 36 characters; the address ends with one, after a hyphen. */
const idLength = 36;

/** Far longer than any slug plus its ID, so a request for a megabyte path is refused before it is looked at. */
export const maxAddressLength = 300;

export type ExperienceAddress = { slug: string; id: string };

/**
 * The slug and ID in `/experiences/[slug]-[id]`, or null when the address is not that shape. The
 * ID is the key, so the slug is checked for shape only; a slug that has since changed still
 * finds its experience.
 */
export function parseExperienceAddress(
  slugAndId: string,
): ExperienceAddress | null {
  if (slugAndId.length > maxAddressLength) return null;
  const idStart = slugAndId.length - idLength;
  if (idStart < 2 || slugAndId[idStart - 1] !== '-') return null;
  const slug = slugAndId.slice(0, idStart - 1);
  const id = slugAndId.slice(idStart);
  if (!isSlug(slug) || !EntityIdSchema.safeParse(id).success) return null;
  return { slug, id: id.toLowerCase() };
}

// ---- Collections, categories, neighborhoods ----

export const picksPath = (slug: string) => `/picks/${slug}`;

/** The id of the first Ramble Picks module, which the header and footer link to. */
export const picksAnchor = 'picks';

/** The home page at its Ramble Picks module. */
export const homePicksHref = `/#${picksAnchor}`;

export const giftGuidePath = '/gifts';

export const categoryPath = (slug: string) => `/new-york/things-to-do/${slug}`;
export const neighborhoodPath = (slug: string) =>
  `/new-york/neighborhoods/${slug}`;

/** The gift checkout for one experience. The page that answers it is the gift checkout unit's. */
export const giftCheckoutPath = (experienceId: string) =>
  `/gifts/checkout/${experienceId}`;

// ---- Checkout and orders ----

export const checkoutPath = (holdId: string) => `/checkout/${holdId}`;
/** The checkout of a hold made again from the ended one; the page moves focus to its heading. */
export const reheldCheckoutPath = (holdId: string) =>
  `${checkoutPath(holdId)}?rehold=1`;
export const orderPath = (reference: string) => `/orders/${reference}`;

// ---- Help and legal ----

export const contactPath = '/contact';
export const helpPath = '/help';
export const accessibilityPath = '/accessibility';

export const legalPath = (doc: 'terms' | 'privacy') => `/legal/${doc}`;

/** Any published document by its key, such as a host's waiver. */
export const legalDocPath = (doc: string) => `/legal/${doc}`;

/**
 * The confirmation page of an order. The order token, which only the paying device is given,
 * travels in the query as `t`.
 */
export function orderConfirmationPath(
  reference: string,
  orderToken?: string,
): string {
  const base = orderPath(reference);
  return orderToken === undefined
    ? base
    : `${base}?t=${encodeURIComponent(orderToken)}`;
}

// ---- Post-booking ----

/** The manage page a booking email links to. The token is a capability: it is never logged or stored. */
export const managePath = (token: string) => `/manage/${token}`;

/**
 * Where a guest asks about a private session until the private-request form exists.
 * @alias
 */
export const privateSessionPath = contactPath;
