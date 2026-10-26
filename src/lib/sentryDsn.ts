const publicKeyPattern = /^[0-9a-f]{16,64}$/i;

/**
 * The address of Sentry's loader script for a browser DSN, or null when the value is not a usable
 * DSN. The loader is keyed by the DSN's public key, which is safe to publish by design.
 */
export function sentryLoaderUrl(dsn: string | undefined): string | null {
  if (!dsn) return null;
  if (!URL.canParse(dsn)) return null;
  const url = new URL(dsn);
  if (url.protocol !== 'https:') return null;
  if (!publicKeyPattern.test(url.username)) return null;
  return `https://js.sentry-cdn.com/${url.username}.min.js`;
}
