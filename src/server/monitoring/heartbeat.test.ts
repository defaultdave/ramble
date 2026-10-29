import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../../tests/msw/server';
import { sendHeartbeat } from './heartbeat';

const warn = vi.hoisted(() => vi.fn());
vi.mock('./logger', () => ({ logger: { warn } }));

// Behaviours under test:
// - with no URL nothing is requested and the result is skipped
// - a 2xx answer is sent, using GET on the URL
// - a non-2xx answer, a network error, and a timeout are failed, logged, and never thrown
// - the log line never holds the URL (it carries a token)

const url = 'https://uptime.example/api/heartbeat/tokenvalue123';

describe('sendHeartbeat', () => {
  it('does nothing with no URL', async () => {
    const seen = vi.fn();
    server.use(
      http.all('*', () => {
        seen();
        return new HttpResponse();
      }),
    );

    await expect(sendHeartbeat(undefined)).resolves.toBe('skipped');
    expect(seen).not.toHaveBeenCalled();
  });

  it('sends one GET', async () => {
    const methods: string[] = [];
    server.use(
      http.get(url, ({ request }) => {
        methods.push(request.method);
        return new HttpResponse(null, { status: 200 });
      }),
    );

    await expect(sendHeartbeat(url)).resolves.toBe('sent');
    expect(methods).toEqual(['GET']);
  });

  it('reports a refusal without throwing or logging the URL', async () => {
    warn.mockClear();
    server.use(http.get(url, () => new HttpResponse(null, { status: 500 })));

    await expect(sendHeartbeat(url)).resolves.toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tokenvalue123');
  });

  it('reports a network error without throwing or logging the URL', async () => {
    warn.mockClear();
    server.use(http.get(url, () => HttpResponse.error()));

    await expect(sendHeartbeat(url)).resolves.toBe('failed');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tokenvalue123');
  });

  it('gives up after five seconds', async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('timed out', 'TimeoutError'));
          });
        }),
    );
    try {
      const result = sendHeartbeat(url);
      controller.abort();

      await expect(result).resolves.toBe('failed');
      expect(timeout).toHaveBeenCalledWith(5000);
    } finally {
      vi.unstubAllGlobals();
      timeout.mockRestore();
    }
  });
});
