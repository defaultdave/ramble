import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from './log';
import { createLogger } from './logger';

function setup(requestId: () => string | undefined = () => undefined) {
  const records: LogRecord[] = [];
  const onSinkError = vi.fn();
  const logger = createLogger({
    sinks: [(record) => records.push(record)],
    requestId,
    onSinkError,
    environment: 'test',
  });
  return { logger, records, onSinkError };
}

describe('createLogger', () => {
  it.each(['debug', 'info', 'warn', 'error'] as const)(
    'writes a %s record',
    (level) => {
      const { logger, records } = setup();

      logger[level]('hello', { a: 1 });

      expect(records).toEqual([
        {
          level,
          message: 'hello',
          service: 'ramble',
          environment: 'test',
          fields: { a: 1 },
        },
      ]);
    },
  );

  it('reads the request ID when it logs, not when it is built', () => {
    const current: { id: string | undefined } = { id: undefined };
    const { logger, records } = setup(() => current.id);

    logger.info('before');
    current.id = 'req-1';
    logger.info('during');

    expect(records.map((r) => r.requestId)).toEqual([undefined, 'req-1']);
  });

  it('redacts what it is given', () => {
    const { logger, records } = setup();

    logger.error('failed for a@b.co', {
      error: new Error('card 4242424242424242'),
    });

    expect(JSON.stringify(records)).not.toContain('a@b.co');
    expect(JSON.stringify(records)).not.toContain('4242424242424242');
  });

  it('gives a child logger its own fields on every record, overridable per call', () => {
    const { logger, records } = setup();
    const job = logger.child({ job: 'deliver_gift', attempt: 1 });

    job.info('start');
    job.child({ giftId: 'g1' }).info('step', { attempt: 2 });

    expect(records.map((r) => r.fields)).toEqual([
      { job: 'deliver_gift', attempt: 1 },
      { job: 'deliver_gift', attempt: 2, giftId: 'g1' },
    ]);
  });

  it('keeps writing to the other sinks when one throws, and reports the failure', () => {
    const records: LogRecord[] = [];
    const onSinkError = vi.fn();
    const logger = createLogger({
      sinks: [
        () => {
          throw new Error('stream closed');
        },
        (record) => records.push(record),
      ],
      requestId: () => undefined,
      onSinkError,
    });

    expect(() => {
      logger.info('still works');
    }).not.toThrow();
    expect(records).toHaveLength(1);
    expect(onSinkError).toHaveBeenCalledOnce();
  });
});
