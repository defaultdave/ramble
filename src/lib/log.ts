import { redact, redactString } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogRecord = {
  level: LogLevel;
  message: string;
  service: 'ramble';
  environment?: string;
  requestId?: string;
  fields?: unknown;
  truncated?: true;
};

/** One serialized log line stays under this many bytes, whatever the caller passes. */
export const maxLogLineBytes = 16_384;

const maxMessageLength = 1_000;
const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

export function buildLogRecord(input: {
  level: LogLevel;
  message: string;
  fields?: Record<string, unknown>;
  requestId?: string | undefined;
  environment?: string | undefined;
}): LogRecord {
  const record: LogRecord = {
    level: input.level,
    message: redactString(input.message, maxMessageLength),
    service: 'ramble',
  };
  if (input.environment) record.environment = input.environment;
  if (input.requestId) record.requestId = input.requestId;
  if (input.fields && Object.keys(input.fields).length > 0) {
    record.fields = redact(input.fields);
  }
  return record;
}

/**
 * The JSON line for a record. A record over {@link maxLogLineBytes} loses its fields, so the line
 * always parses and still names the request. The message is already cut to a length that fits.
 */
export function serializeLogRecord(record: LogRecord): string {
  const whole = JSON.stringify(record);
  if (byteLength(whole) <= maxLogLineBytes) return whole;

  const { level, message, service, environment, requestId } = record;
  return JSON.stringify({
    level,
    message,
    service,
    environment,
    requestId,
    truncated: true,
  });
}
