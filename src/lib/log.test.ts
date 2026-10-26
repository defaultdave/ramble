import { describe, expect, it } from 'vitest';
import {
  buildLogRecord,
  maxLogLineBytes,
  serializeLogRecord,
  type LogRecord,
} from './log';

describe('buildLogRecord', () => {
  it('stamps the service, level, request ID, and environment', () => {
    expect(
      buildLogRecord({
        level: 'info',
        message: 'hello',
        requestId: 'req-1',
        environment: 'preview',
      }),
    ).toEqual({
      level: 'info',
      message: 'hello',
      service: 'ramble',
      requestId: 'req-1',
      environment: 'preview',
    });
  });

  it('omits fields when there are none', () => {
    expect(
      buildLogRecord({ level: 'info', message: 'm', fields: {} }),
    ).not.toHaveProperty('fields');
  });

  it('redacts the message and every field', () => {
    const record = buildLogRecord({
      level: 'error',
      message: 'mail to a@b.co failed',
      fields: { email: 'a@b.co', nested: { note: 'card 4242424242424242' } },
    });

    expect(JSON.stringify(record)).not.toContain('a@b.co');
    expect(JSON.stringify(record)).not.toContain('4242424242424242');
  });

  it('cuts a long message', () => {
    const record = buildLogRecord({
      level: 'info',
      message: 'a b '.repeat(2_000),
    });

    expect(record.message.length).toBeLessThan(1_100);
  });
});

describe('serializeLogRecord', () => {
  it('writes one parseable JSON line', () => {
    const record = buildLogRecord({
      level: 'warn',
      message: 'm',
      fields: { a: 1 },
    });

    expect(JSON.parse(serializeLogRecord(record))).toEqual(record);
    expect(serializeLogRecord(record)).not.toContain('\n');
  });

  it('drops fields from a record over the byte limit and says so', () => {
    const record: LogRecord = {
      level: 'error',
      message: 'big',
      service: 'ramble',
      requestId: 'req-9',
      fields: { blob: 'x'.repeat(maxLogLineBytes) },
    };

    const line = serializeLogRecord(record);

    expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(
      maxLogLineBytes,
    );
    expect(JSON.parse(line)).toEqual({
      level: 'error',
      message: 'big',
      service: 'ramble',
      requestId: 'req-9',
      truncated: true,
    });
  });

  it('measures bytes, not characters', () => {
    const record: LogRecord = {
      level: 'info',
      message: 'm',
      service: 'ramble',
      fields: { emoji: '😀'.repeat(maxLogLineBytes / 4) },
    };

    expect(JSON.parse(serializeLogRecord(record))).toHaveProperty(
      'truncated',
      true,
    );
  });

  it('bounds any record that buildLogRecord can produce', () => {
    const record = buildLogRecord({
      level: 'error',
      message: '😀'.repeat(5_000),
      fields: Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          `k${String(i)}`,
          '😀'.repeat(2_000),
        ]),
      ),
    });

    expect(
      new TextEncoder().encode(serializeLogRecord(record)).byteLength,
    ).toBeLessThanOrEqual(maxLogLineBytes);
  });
});
