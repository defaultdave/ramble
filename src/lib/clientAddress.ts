const maxAddressLength = 45;
const addressShape = /^[0-9a-f:.]+$/;

/**
 * The caller's network address, as one lower-case string that can key a rate limit. Vercel sets
 * `x-forwarded-for` itself and drops client-supplied values, so its first entry is the client.
 * Anything absent, over-long, or not shaped like an address collapses to one shared "unknown", so
 * a forged header can neither grow the key space nor dodge a limit.
 */
export function clientAddress(forwardedFor: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.length > 0 &&
    first.length <= maxAddressLength &&
    addressShape.test(first)
    ? first
    : 'unknown';
}
