import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveRequestId } from '@/lib/requestId';

type RequestContext = { requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** The request ID carried by a request's headers, or a new one when it carries none. */
function requestIdFromHeaders(headers: Headers): string {
  return resolveRequestId(
    {
      requestId: headers.get('x-request-id'),
      platformId: headers.get('x-vercel-id'),
    },
    () => crypto.randomUUID(),
  );
}

/** Headers from the plain record Next.js hands to `onRequestError`; repeated values keep the first. */
export function headersFromRecord(
  record: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(record)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) headers.set(name, first);
  }
  return headers;
}

/**
 * Runs `work` with a request ID that every logger call and error report inside it picks up.
 * Route Handlers and Server Actions wrap their body in this with the request's headers.
 */
export function withRequestContext<T>(headers: Headers, work: () => T): T {
  return storage.run({ requestId: requestIdFromHeaders(headers) }, work);
}
