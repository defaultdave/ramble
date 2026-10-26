import { z } from 'zod';
import { redactString } from './redact';

const alertSeverities = ['warning', 'error', 'critical'] as const;
export type AlertSeverity = (typeof alertSeverities)[number];

// Sentry's own level names; its "fatal" is the level Ramble calls critical.
const sentryLevels = {
  warning: 'warning',
  error: 'error',
  critical: 'fatal',
} as const satisfies Record<AlertSeverity, string>;

type SentryLevel = (typeof sentryLevels)[AlertSeverity];

/** Tag that marks an issue as one Ramble raised on purpose; the Sentry alert rules filter on it. */
export const alertTag = 'ramble_alert';

const runbookBase =
  'https://github.com/defaultdave/ramble/blob/main/docs/runbooks';

// A kind names its runbook file, so it is lowercase words joined by hyphens and nothing else.
const alertSchema = z.object({
  kind: z
    .string()
    .max(48)
    .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  severity: z.enum(alertSeverities),
  dedupeKey: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/),
});

type AlertInput = z.infer<typeof alertSchema>;

export type PreparedAlert = AlertInput & {
  level: SentryLevel;
  runbookUrl: string;
  title: string;
  /** Sentry groups events with the same fingerprint into one issue. */
  fingerprint: [string, string];
};

export function runbookUrl(kind: string): string {
  return `${runbookBase}/${kind}.md`;
}

/**
 * Validates an alert and derives what Sentry needs. Throws on a kind, severity, or dedupe key
 * outside the rules: a bad alert is a bug in the caller and is not repaired.
 */
export function prepareAlert(input: {
  kind: string;
  severity: string;
  dedupeKey: string;
}): PreparedAlert {
  const parsed = alertSchema.parse(input);
  // The fingerprint reaches Sentry as it is, so a key that redaction would change (a hash, a
  // token, a long mixed-case ID) is refused here instead of being altered on the way out.
  for (const value of [parsed.kind, parsed.dedupeKey]) {
    if (redactString(value) !== value) {
      throw new Error('Alert kind and dedupe key must not look like a secret');
    }
  }
  return {
    ...parsed,
    level: sentryLevels[parsed.severity],
    runbookUrl: runbookUrl(parsed.kind),
    title: `${parsed.kind}: ${parsed.dedupeKey}`,
    fingerprint: [parsed.kind, parsed.dedupeKey],
  };
}
