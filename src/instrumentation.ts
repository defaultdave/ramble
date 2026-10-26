import type { Instrumentation } from 'next';

// Next.js compiles this file for the edge runtime too and replaces `process.env.NEXT_RUNTIME` with
// a literal, so the guard below keeps the Node-only monitoring modules out of the edge bundle.
// Ramble has no edge code; the guard is only about the build.

/** Runs once when the server starts, so a bad environment fails at boot, not on the first request. */
export async function register() {
  await import('@/server/env');
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { initSentry } = await import('@/server/monitoring/sentry');
  initSentry();
}

/** Next.js calls this for every error thrown while rendering, in an action, or in a Route Handler. */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { logger } = await import('@/server/monitoring/logger');
  const { captureException } = await import('@/server/monitoring/sentry');
  const { headersFromRecord, withRequestContext } =
    await import('@/server/monitoring/requestContext');

  // The route pattern, never the raw path: a manage or gift path carries a capability token.
  const where = {
    route: context.routePath,
    routeType: context.routeType,
    method: request.method,
  };
  withRequestContext(headersFromRecord(request.headers), () => {
    logger.error('request failed', { ...where, error });
    captureException(error, {
      tags: {
        route: context.routePath,
        route_type: context.routeType,
        method: request.method,
      },
    });
  });
};
