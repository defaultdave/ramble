import 'server-only';
import { prepareAlert, type AlertSeverity } from '@/lib/alerts';
import { logger } from './logger';
import { captureAlert } from './sentry';

type AlertContext = Record<string, unknown>;

// TODO(U-048): first caller, the payment webhook intake.
export const alerts = {
  /**
   * Raises an operational alert: one structured log line (which also reaches Axiom) and one
   * Sentry issue carrying the runbook link. Calls with the same `kind` and `dedupeKey` land in
   * the same Sentry issue, so a retry loop raises one issue, not one per retry.
   *
   * Throws on a malformed `kind`, `severity`, or `dedupeKey`, before anything is sent. A failure
   * to deliver to Sentry never throws: alerts are raised from payment and job paths that must
   * finish their own work.
   */
  raise(
    kind: string,
    severity: AlertSeverity,
    dedupeKey: string,
    context: AlertContext = {},
  ): void {
    const alert = prepareAlert({ kind, severity, dedupeKey });
    const log = severity === 'warning' ? logger.warn : logger.error;
    log(`alert ${alert.title}`, {
      alert: true,
      kind: alert.kind,
      severity: alert.severity,
      dedupeKey: alert.dedupeKey,
      runbook: alert.runbookUrl,
      context,
    });
    try {
      captureAlert(alert, context);
    } catch (error) {
      logger.error('alert could not be sent to Sentry', {
        kind: alert.kind,
        error,
      });
    }
  },
};
