import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveRequestId } from '@/lib/requestId';

type RequestContext = { requestId: string };

/** The headers of a request: a `Headers` object, or the plain record Next.js gives `onRequestError`. */
type RequestHeaders = Headers | Record<string, string | string[] | undefined>;

const storage = new AsyncLocalStorage<RequestContext>();

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

// Next.js refuses `crypto.randomUUID()` and `Math.random()` while it prerenders, and an error
// thrown during a prerender is reported from inside that context. A process-local sequence has
// no such restriction; it only has to tell requests apart in one deployment's logs.
const bootId = `${process.pid.toString(36)}${process.hrtime.bigint().toString(36)}`;
let sequence = 0;

function localRequestId(): string {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
  return `local-${bootId}-${sequence.toString(36)}`;
}

// Read by name rather than copied into a `Headers`: HTTP/2 requests carry pseudo-headers such as
// `:authority`, and `Headers.set` throws on those.
function headerValue(
  headers: RequestHeaders,
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The request ID carried by a request's headers, or a new one when it carries none. */
function requestIdFrom(headers: RequestHeaders): string {
  return resolveRequestId(
    {
      requestId: headerValue(headers, 'x-request-id'),
      platformId: headerValue(headers, 'x-vercel-id'),
    },
    localRequestId,
  );
}

/**
 * Runs `work` with a request ID that every logger call and error report inside it picks up.
 * Route Handlers and Server Actions wrap their body in this with the request's headers.
 */
export function withRequestContext<T>(
  headers: RequestHeaders,
  work: () => T,
): T {
  return storage.run({ requestId: requestIdFrom(headers) }, work);
}
