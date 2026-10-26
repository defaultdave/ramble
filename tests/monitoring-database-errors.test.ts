import * as Sentry from '@sentry/nextjs';
import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A failed query in drizzle-orm becomes a DrizzleQueryError whose message ends with the bound
// values, wrapping the driver's error, which quotes the row in `detail`. These tests send the
// real error classes through the real logger and the real Sentry SDK (transport replaced, so
// nothing leaves the process).
const sent = vi.hoisted(() => [] as unknown[]);

vi.mock('@sentry/nextjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sentry/nextjs')>();
  const init = (options: Parameters<typeof actual.init>[0]) =>
    actual.init({
      ...options,
      transport: () => ({
        send: (envelope: unknown) => {
          sent.push(envelope);
          return Promise.resolve({});
        },
        flush: () => Promise.resolve(true),
      }),
    });
  return new Proxy(actual, {
    get: (target, property, receiver) =>
      property === 'init'
        ? init
        : (Reflect.get(target, property, receiver) as unknown),
  });
});

const dsn = 'https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.io/1';
const secrets = [
  'Ada Lovelace',
  '1815-12-10',
  '555 0100',
  'allergic to nuts',
  'likes tea',
  'ada@example.com',
];

function failedInsert() {
  const driver = new DatabaseError(
    'duplicate key value violates unique constraint "guests_email_key"',
    0,
    'error',
  );
  driver.detail = 'Key (email)=(ada@example.com) already exists.';
  driver.where = 'COPY guests, line 1: "ada@example.com"';
  driver.code = '23505';
  return new DrizzleQueryError(
    'insert into "guests" ("full_name", "birth_date", "phone", "notes") values ($1, $2, $3, $4)',
    [
      'Ada Lovelace',
      '1815-12-10',
      '+1 212 555 0100',
      'allergic to nuts\nlikes tea',
    ],
    driver,
  );
}

function expectClean(text: string) {
  for (const secret of secrets) expect(text).not.toContain(secret);
}

afterEach(async () => {
  await Sentry.close(100);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('a real DrizzleQueryError', () => {
  it('carries the row values, so the test means something', () => {
    const error = failedInsert();

    expect(error.message).toContain('Ada Lovelace');
    expect(error.cause?.message).not.toContain('ada@example.com');
    expect((error.cause as DatabaseError).detail).toContain('ada@example.com');
  });

  it('reaches the log without its values, from the error field or from the message', async () => {
    vi.resetModules();
    const out = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const err = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const { logger } = await import('@/server/monitoring/logger');
    const error = failedInsert();

    logger.error('insert failed', { error });
    logger.error(`insert failed: ${error.message}`);
    logger.warn('insert failed', {
      err: { message: error.message, query: error.query, params: error.params },
    });

    const lines = [...out.mock.calls, ...err.mock.calls].map(([line]) =>
      String(line),
    );
    expect(lines).toHaveLength(3);
    for (const line of lines) expectClean(line);
    expect(lines[0]).toContain('Failed query: insert into \\"guests\\"');
    expect(lines[0]).toContain('guests_email_key');
  });

  it('reaches Sentry without its values, in the exception, its cause, and the context', async () => {
    vi.resetModules();
    vi.stubEnv('SENTRY_DSN', dsn);
    const { initSentry, captureException } =
      await import('@/server/monitoring/sentry');
    initSentry();
    const error = failedInsert();

    captureException(error, {
      extra: { error, sql: error.query, params: error.params },
    });
    await Sentry.flush(1_000);

    const events = (sent as [unknown, [{ type: string }, object][]][])
      .flatMap(([, items]) => items)
      .filter(([header]) => header.type === 'event')
      .map(([, payload]) => payload);
    expect(events).toHaveLength(1);
    const text = JSON.stringify(events[0]);
    expectClean(text);
    expect(text).toContain('Failed query: insert into');
    expect(text).toContain('guests_email_key');
  });

  it('reaches an alert without its values', async () => {
    vi.resetModules();
    vi.stubEnv('SENTRY_DSN', dsn);
    const err = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const { initSentry } = await import('@/server/monitoring/sentry');
    const { alerts } = await import('@/server/monitoring/alerts');
    initSentry();

    alerts.raise('database-failure', 'error', 'guests-insert', {
      error: failedInsert(),
    });
    await Sentry.flush(1_000);

    expectClean(JSON.stringify(sent));
    expectClean(err.mock.calls.map(([line]) => String(line)).join('\n'));
  });
});
