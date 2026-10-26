import { buildLogRecord, type LogLevel, type LogRecord } from './log';
import { UNREDACTABLE } from './redact';

export type LogSink = (record: LogRecord) => void;

export type Logger = {
  debug: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
  /** A logger whose records all carry `fields`, for one job or one webhook. */
  child: (fields: Record<string, unknown>) => Logger;
};

export type LoggerOptions = {
  sinks: readonly LogSink[];
  /** Read at log time, so a record carries the ID of the request it is written in. */
  requestId: () => string | undefined;
  /** Told when a sink throws; a broken sink must not fail the code that logged. */
  onSinkError: (error: unknown) => void;
  environment?: string;
  bindings?: Record<string, unknown>;
};

// Reading a field can run caller code (a getter, a proxy). One field that throws becomes a
// placeholder for that field, and the rest are kept.
function readFields(
  source: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!source) return {};
  let keys: string[];
  try {
    keys = Object.keys(source);
  } catch {
    return { fields: UNREDACTABLE };
  }
  return Object.fromEntries(
    keys.map((key): [string, unknown] => {
      try {
        return [key, source[key]];
      } catch {
        return [key, UNREDACTABLE];
      }
    }),
  );
}

export function createLogger(options: LoggerOptions): Logger {
  const bindings = options.bindings ?? {};

  function write(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ) {
    const record = buildLogRecord({
      level,
      message,
      fields: { ...bindings, ...readFields(fields) },
      requestId: options.requestId(),
      environment: options.environment,
    });
    for (const sink of options.sinks) {
      try {
        sink(record);
      } catch (error) {
        options.onSinkError(error);
      }
    }
  }

  return {
    debug: (message, fields) => {
      write('debug', message, fields);
    },
    info: (message, fields) => {
      write('info', message, fields);
    },
    warn: (message, fields) => {
      write('warn', message, fields);
    },
    error: (message, fields) => {
      write('error', message, fields);
    },
    child: (fields) =>
      createLogger({
        ...options,
        bindings: { ...bindings, ...readFields(fields) },
      }),
  };
}
