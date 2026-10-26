import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { waitUntil } from '@vercel/functions';
import { alertTag, type PreparedAlert } from '@/lib/alerts';
import { redact } from '@/lib/redact';
import { scrubBreadcrumb, scrubEvent } from '@/lib/scrubEvent';
import { env } from '@/server/env';
import { currentRequestId } from './requestContext';

const flushTimeoutMs = 2_000;

/**
 * Starts server-side error capture from the environment. With no `SENTRY_DSN` nothing is started,
 * so every capture below is a no-op and the app runs the same as with Sentry on. Returns whether
 * capture is on.
 *
 * Every event and breadcrumb passes through the redaction in `@/lib/scrubEvent` before it leaves
 * the process. `dataCollection` switches off everything the SDK
 * would attach by itself (user info, cookies, headers, bodies, query strings, query data, local
 * variables), so the redaction is a second net, not the only one. No browser SDK starts here: `instrumentation-client` does not
 * exist, so checkout pages carry no Sentry script.
 */
export function initSentry(): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.VERCEL_ENV ?? env.NODE_ENV,
    release: env.VERCEL_GIT_COMMIT_SHA,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    maxBreadcrumbs: 30,
    maxValueLength: 1_000,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  return true;
}

// A serverless function can freeze the moment the response ends, before the SDK has sent.
function flushBeforeFreeze() {
  waitUntil(Sentry.flush(flushTimeoutMs));
}

function tagRequest(scope: Sentry.Scope) {
  const requestId = currentRequestId();
  if (requestId) scope.setTag('request_id', requestId);
}

export function captureException(
  error: unknown,
  details: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  } = {},
): void {
  Sentry.withScope((scope) => {
    tagRequest(scope);
    scope.setTags(details.tags ?? {});
    scope.setContext(
      'details',
      redact(details.extra ?? {}) as Record<string, unknown>,
    );
    Sentry.captureException(error);
  });
  flushBeforeFreeze();
}

/** Opens (or adds an event to) the Sentry issue for an alert; the fingerprint decides which. */
export function captureAlert(
  alert: PreparedAlert,
  context: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    tagRequest(scope);
    scope.setLevel(alert.level);
    scope.setFingerprint(alert.fingerprint);
    scope.setTags({
      [alertTag]: 'true',
      alert_kind: alert.kind,
      alert_severity: alert.severity,
      runbook: alert.runbookUrl,
    });
    scope.setContext('alert', {
      kind: alert.kind,
      severity: alert.severity,
      dedupe_key: alert.dedupeKey,
      runbook_url: alert.runbookUrl,
    });
    scope.setContext('details', redact(context) as Record<string, unknown>);
    Sentry.captureMessage(alert.title, alert.level);
  });
  flushBeforeFreeze();
}
