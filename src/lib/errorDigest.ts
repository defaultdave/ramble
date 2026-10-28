/**
 * The digest Next.js puts on an error that crossed a cached function, or undefined when there is
 * none. It is all a page logs of such an error: Next.js has already logged the error itself with
 * the same digest, so the two lines can be matched without the message or the cause leaving the server.
 */
export function errorDigest(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('digest' in error)) return undefined;
  return typeof error.digest === 'string' ? error.digest : undefined;
}
