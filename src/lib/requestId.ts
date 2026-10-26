const maxRequestIdLength = 64;
const safeRequestId = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function usable(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > maxRequestIdLength) return null;
  return safeRequestId.test(trimmed) ? trimmed : null;
}

/**
 * Picks the ID that follows one request through every log line and error report: an ID the caller
 * sent (`x-request-id`), else the platform's (`x-vercel-id`), else a new one. An incoming value
 * that is too long or holds anything outside letters, digits, and `._:-` is discarded rather than
 * cleaned, because it ends up in log lines and Sentry tags.
 */
export function resolveRequestId(
  incoming: {
    requestId?: string | null;
    platformId?: string | null;
  },
  generate: () => string,
): string {
  return (
    usable(incoming.requestId) ?? usable(incoming.platformId) ?? generate()
  );
}
