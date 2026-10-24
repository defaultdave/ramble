const WEB_AND_CONTACT_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
]);

const MAX_HREF_LENGTH = 2048;

// Browsers strip tabs and newlines from a URL and read a backslash as a slash, so any
// whitespace, control character, or backslash could hide a scheme or turn `/\host` into
// a link to another site.
const UNSAFE_CHARACTERS = /[\p{Cc}\s\\]/u;

/**
 * Returns the link target when it is safe to render, and null when it is not. Allowed:
 * http, https, mailto, and tel URLs, paths on this site, and in-page anchors.
 */
export function safeLinkHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (href === '' || href.length > MAX_HREF_LENGTH) return null;
  if (UNSAFE_CHARACTERS.test(href)) return null;

  if (href.startsWith('#')) return href;
  // `//host` is a link to another site written without a scheme.
  if (href.startsWith('/')) return href.startsWith('//') ? null : href;

  if (!URL.canParse(href)) return null;
  return WEB_AND_CONTACT_PROTOCOLS.has(new URL(href).protocol) ? href : null;
}

export function isWebUrl(href: string): boolean {
  return /^https?:/i.test(href);
}
