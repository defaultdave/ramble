import 'server-only';
import { waitUntil } from '@vercel/functions';
import { serializeLogRecord, type LogRecord } from '@/lib/log';

const ingestBase = 'https://api.axiom.co/v1/datasets';

export type AxiomSinkOptions = {
  token: string;
  dataset: string;
  fetchImpl?: typeof fetch;
  /** Keeps the serverless function alive until the request finishes. */
  keepAlive?: (pending: Promise<unknown>) => void;
  timeoutMs?: number;
  /** Sends past this many unfinished requests are dropped, so an error storm cannot pile up. */
  maxInFlight?: number;
  reportFailure?: (message: string) => void;
};

/**
 * Sends warning and error records to Axiom. One request per record, because these are rare;
 * a request that fails or times out is reported to stderr once and never retried or thrown,
 * since the record is already on stdout.
 */
export function createAxiomSink(options: AxiomSinkOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const keepAlive = options.keepAlive ?? waitUntil;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const maxInFlight = options.maxInFlight ?? 10;
  const reportFailure =
    options.reportFailure ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const url = `${ingestBase}/${encodeURIComponent(options.dataset)}/ingest`;
  let inFlight = 0;

  return (record: LogRecord): void => {
    if (record.level !== 'warn' && record.level !== 'error') return;
    if (inFlight >= maxInFlight) return;
    inFlight += 1;

    const sent = fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      body: `[${serializeLogRecord(record)}]`,
      signal: AbortSignal.timeout(timeoutMs),
    })
      .then((response) => {
        if (!response.ok) {
          reportFailure(
            `axiom ingest refused: HTTP ${String(response.status)}`,
          );
        }
      })
      .catch((error: unknown) => {
        // The name only: a fetch error message can echo the URL.
        reportFailure(
          `axiom ingest failed: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      })
      .finally(() => {
        inFlight -= 1;
      });
    keepAlive(sent);
  };
}
