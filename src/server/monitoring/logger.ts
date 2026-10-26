import 'server-only';
import { serializeLogRecord } from '@/lib/log';
import { createLogger, type LogSink } from '@/lib/logger';
import { env } from '@/server/env';
import { createAxiomSink } from './axiom';
import { currentRequestId } from './requestContext';

/** One JSON line per record on the stream Vercel files it under: stderr for warnings and errors. */
const stdoutSink: LogSink = (record) => {
  const stream =
    record.level === 'warn' || record.level === 'error'
      ? process.stderr
      : process.stdout;
  stream.write(`${serializeLogRecord(record)}\n`);
};

function defaultSinks(): LogSink[] {
  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) return [stdoutSink];
  return [
    stdoutSink,
    createAxiomSink({ token: env.AXIOM_TOKEN, dataset: env.AXIOM_DATASET }),
  ];
}

export const logger = createLogger({
  sinks: defaultSinks(),
  requestId: currentRequestId,
  onSinkError: (error) => {
    process.stderr.write(
      `log sink failed: ${error instanceof Error ? error.name : 'unknown'}\n`,
    );
  },
  environment: env.VERCEL_ENV ?? env.NODE_ENV,
});
