import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initSentry = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());
const log = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('@/server/monitoring/sentry', () => ({ initSentry, captureException }));
vi.mock('@/server/monitoring/logger', () => ({ logger: log }));

const { register, onRequestError } = await import('./instrumentation');
const { currentRequestId } = await import('@/server/monitoring/requestContext');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('register', () => {
  it('starts error capture once the environment has validated', async () => {
    await register();

    expect(initSentry).toHaveBeenCalledOnce();
  });
});

describe('outside the Node.js runtime', () => {
  it('starts no capture and reports no request error', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');

    await register();
    await onRequestError(
      new Error('boom'),
      { path: '/', method: 'GET', headers: {} },
      {
        routerKind: 'App Router',
        routePath: '/',
        routeType: 'render',
        renderSource: 'react-server-components',
        revalidateReason: undefined,
      },
    );

    expect(initSentry).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('onRequestError', () => {
  const context = {
    routerKind: 'App Router',
    routePath: '/manage/[token]',
    routeType: 'render',
    renderSource: 'react-server-components',
    revalidateReason: undefined,
  } as const;

  it('logs and captures the error under the route pattern, never the raw path', async () => {
    const error = new Error('boom');
    let idDuringLog: string | undefined;
    log.error.mockImplementation(() => {
      idDuringLog = currentRequestId();
    });

    await onRequestError(
      error,
      {
        path: '/manage/q7Hk2mVx9RtLw3NfZ8bYc1DsJ6aPe4UoG0iAhXnT5vE',
        method: 'GET',
        headers: { 'x-request-id': 'req-42' },
      },
      context,
    );

    expect(log.error).toHaveBeenCalledWith('request failed', {
      route: '/manage/[token]',
      routeType: 'render',
      method: 'GET',
      error,
    });
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: { route: '/manage/[token]', route_type: 'render', method: 'GET' },
    });
    expect(
      JSON.stringify([...log.error.mock.calls, ...captureException.mock.calls]),
    ).not.toContain('q7Hk2mVx9RtLw3NfZ8bYc1DsJ6aPe4UoG0iAhXnT5vE');
    expect(idDuringLog).toBe('req-42');
  });

  it('does not require the request to carry an ID', async () => {
    await onRequestError(
      new Error('boom'),
      { path: '/', method: 'GET', headers: {} },
      context,
    );

    expect(captureException).toHaveBeenCalledOnce();
  });
});
