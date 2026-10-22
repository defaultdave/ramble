import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from './msw/server';

describe('network mocking', () => {
  it('answers a request with the handler registered for it', async () => {
    server.use(
      http.get('https://example.test/ping', () =>
        HttpResponse.json({ ok: true }),
      ),
    );

    const response = await fetch('https://example.test/ping');

    expect(await response.json()).toEqual({ ok: true });
  });

  it('fails a request that no handler covers', async () => {
    const failure = await fetch('https://example.test/unhandled').catch(
      (error: Error) => error,
    );

    expect(String((failure as Error).cause)).toMatch(
      /\[MSW\].*"error" strategy/,
    );
  });

  it('drops per-test handlers after each test', async () => {
    const failure = await fetch('https://example.test/ping').catch(
      (error: Error) => error,
    );

    expect(failure).toBeInstanceOf(Error);
  });
});
