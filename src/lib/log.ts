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

// The message is typed as a string, but a logger is called from catch blocks and from code that
// passes whatever it has; a non-string is redacted like any other value and written as JSON.
function messageText(message: unknown): string {
  if (typeof message === 'string') {
    return redactString(message, maxMessageLength);
  }
  const redacted = redact(message);
  // JSON.stringify returns undefined for undefined, which its type does not say.
  const json = JSON.stringify(redacted) as string | undefined;
  const text =
    typeof redacted === 'string' ? redacted : (json ?? String(redacted));
  return redactString(text, maxMessageLength);
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

/** Builds the record for one log call. Never throws, whatever it is given. */
export function buildLogRecord(input: {
  level: LogLevel;
  message: unknown;
  fields?: unknown;
  requestId?: string | undefined;
  environment?: string | undefined;
}): LogRecord {
  const record: LogRecord = {
    level: input.level,
    message: messageText(input.message),
    service: 'ramble',
  };
  if (input.environment) record.environment = input.environment;
  if (input.requestId) record.requestId = input.requestId;
  if (input.fields !== undefined && input.fields !== null) {
    const fields = redact(input.fields);
    if (!isEmptyObject(fields)) record.fields = fields;
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
