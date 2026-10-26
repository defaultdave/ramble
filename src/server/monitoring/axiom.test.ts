import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@/lib/log';
import { createAxiomSink } from './axiom';

const record = (
  level: LogRecord['level'],
  extra: Partial<LogRecord> = {},
): LogRecord => ({
  level,
  message: 'm',
  service: 'ramble',
  ...extra,
});

function setup(overrides: Partial<Parameters<typeof createAxiomSink>[0]> = {}) {
  const fetchImpl = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response('{}', { status: 200 })),
  );
  const keepAlive = vi.fn<(pending: Promise<unknown>) => void>();
  const reportFailure = vi.fn<(message: string) => void>();
  const sink = createAxiomSink({
    token: 'xaat-test-token',
    dataset: 'ramble-logs',
    fetchImpl,
    keepAlive,
    reportFailure,
    ...overrides,
  });
  return { sink, fetchImpl, keepAlive, reportFailure };
}

describe('Axiom sink', () => {
  it.each(['debug', 'info'] as const)('does not send %s records', (level) => {
    const { sink, fetchImpl } = setup();

    sink(record(level));

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['warn', 'error'] as const)('sends %s records', (level) => {
    const { sink, fetchImpl } = setup();

    sink(record(level, { requestId: 'req-1' }));

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.axiom.co/v1/datasets/ramble-logs/ingest');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer xaat-test-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init?.body as string)).toEqual([
      { level, message: 'm', service: 'ramble', requestId: 'req-1' },
    ]);
  });

  it('bounds the wait with a timeout', () => {
    const { sink, fetchImpl } = setup();

    sink(record('error'));

    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps the function alive until the request settles', async () => {
    const { sink, keepAlive } = setup();

    sink(record('error'));

    expect(keepAlive).toHaveBeenCalledOnce();
    await expect(keepAlive.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });

  it('reports a refusal by status only, without throwing', async () => {
    const { sink, keepAlive, reportFailure } = setup({
      fetchImpl: () =>
        Promise.resolve(
          new Response('bad token xaat-test-token', { status: 401 }),
        ),
    });

    sink(record('error'));
    await keepAlive.mock.calls[0]?.[0];

    expect(reportFailure).toHaveBeenCalledWith(
      'axiom ingest refused: HTTP 401',
    );
  });

  it('reports a network failure by error name only, without throwing', async () => {
    const { sink, keepAlive, reportFailure } = setup({
      fetchImpl: () =>
        Promise.reject(
          new TypeError('fetch failed https://api.axiom.co/xaat-test-token'),
        ),
    });

    sink(record('error'));
    await keepAlive.mock.calls[0]?.[0];

    expect(reportFailure).toHaveBeenCalledWith(
      'axiom ingest failed: TypeError',
    );
  });

  it('drops records past the in-flight cap and resumes when requests finish', async () => {
    const releases: (() => void)[] = [];
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(() => {
            resolve(new Response('{}'));
          });
        }),
    );
    const { sink, keepAlive } = setup({ maxInFlight: 2, fetchImpl });

    sink(record('error'));
    sink(record('error'));
    sink(record('error'));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    releases.forEach((release) => {
      release();
    });
    await Promise.all(keepAlive.mock.calls.map(([pending]) => pending));
    sink(record('error'));

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('encodes the dataset name in the path', () => {
    const { sink, fetchImpl } = setup({ dataset: 'a/b' });

    sink(record('error'));

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://api.axiom.co/v1/datasets/a%2Fb/ingest',
    );
  });
});
