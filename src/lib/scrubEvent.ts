import { redact, redactString, REDACTED, type RedactLimits } from './redact';

// An error report is bigger than a log line: stack frames and breadcrumbs are many small values.
const eventLimits: Partial<RedactLimits> = {
  maxDepth: 8,
  maxArrayItems: 100,
  maxNodes: 5_000,
  maxTotalChars: 100_000,
};

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function without(bag: Bag, ...keys: string[]): Bag {
  return Object.fromEntries(
    Object.entries(bag).filter(([key]) => !keys.includes(key)),
  );
}

function scrubText(value: unknown): unknown {
  return typeof value === 'string' ? redactString(value) : value;
}

function scrubList(value: unknown, scrubItem: (item: unknown) => unknown) {
  return Array.isArray(value) ? value.slice(0, 200).map(scrubItem) : value;
}

// Contexts the SDK fills with its own structural values (trace IDs are 32 hex characters, which
// the opaque-token rule would otherwise destroy). Any other context is app data and is redacted.
const structuralContexts = new Set([
  'trace',
  'runtime',
  'os',
  'device',
  'app',
  'culture',
  'cloud_resource',
]);

function scrubException(value: unknown): unknown {
  if (!isBag(value)) return value;
  return {
    ...value,
    values: scrubList(value.values, (entry) => {
      if (!isBag(entry)) return entry;
      return {
        ...entry,
        value: scrubText(entry.value),
        mechanism: isBag(entry.mechanism)
          ? {
              ...entry.mechanism,
              data: redact(entry.mechanism.data, eventLimits),
            }
          : entry.mechanism,
        // Local variables are never wanted: they hold whatever the code held.
        stacktrace: isBag(entry.stacktrace)
          ? {
              ...entry.stacktrace,
              frames: scrubList(entry.stacktrace.frames, (frame) => {
                if (!isBag(frame)) return frame;
                return without(frame, 'vars');
              }),
            }
          : entry.stacktrace,
      };
    }),
  };
}

function scrubRequest(value: unknown): unknown {
  if (!isBag(value)) return value;
  // Cookies and bodies carry sessions and form data; they are dropped, not redacted.
  return redact(without(value, 'cookies', 'data'), eventLimits);
}

function scrubContexts(value: unknown): unknown {
  if (!isBag(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, context]) => [
      name,
      structuralContexts.has(name) ? context : redact(context, eventLimits),
    ]),
  );
}

function scrubUser(value: unknown): unknown {
  if (!isBag(value)) return value;
  // Only an opaque ID may identify a person to Sentry; email, name, and IP address are dropped.
  return typeof value.id === 'string' || typeof value.id === 'number'
    ? { id: redact(value.id) }
    : { id: REDACTED };
}

function scrubBreadcrumbValue(value: unknown): unknown {
  if (!isBag(value)) return value;
  return {
    ...value,
    message: scrubText(value.message),
    data: redact(value.data, eventLimits),
  };
}

/** A breadcrumb is recorded long before any error, so it is scrubbed as it is added. */
export function scrubBreadcrumb<T extends object>(breadcrumb: T): T {
  return scrubBreadcrumbValue(breadcrumb) as T;
}

/**
 * Redacts an error event or a message event before it leaves the process. Sections that hold
 * application data (message, exception text, request, user, extra, tags, custom contexts,
 * breadcrumbs, transaction) are scrubbed; sections the SDK fills itself (event ID,
 * timestamps, SDK info, stack frame locations, trace context) are kept as they are. So is the
 * fingerprint, which `prepareAlert` has already refused to build from anything that looks secret;
 * scrubbing it here would merge unrelated alerts into one issue.
 */
export function scrubEvent<T extends object>(event: T): T {
  const source = event as Bag;
  const out: Bag = { ...source };

  for (const key of ['message', 'transaction', 'culprit']) {
    if (key in out) out[key] = scrubText(out[key]);
  }
  if ('logentry' in out && isBag(out.logentry)) {
    out.logentry = {
      ...out.logentry,
      message: scrubText(out.logentry.message),
      params: redact(out.logentry.params, eventLimits),
    };
  }
  if ('exception' in out) out.exception = scrubException(out.exception);
  if ('request' in out) out.request = scrubRequest(out.request);
  if ('user' in out) out.user = scrubUser(out.user);
  if ('extra' in out) out.extra = redact(out.extra, eventLimits);
  if ('tags' in out) out.tags = redact(out.tags, eventLimits);
  if ('contexts' in out) out.contexts = scrubContexts(out.contexts);
  if ('breadcrumbs' in out) {
    out.breadcrumbs = scrubList(out.breadcrumbs, scrubBreadcrumbValue);
  }
  return out as T;
}
