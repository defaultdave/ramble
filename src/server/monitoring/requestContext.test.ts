import { describe, expect, it } from 'vitest';
import {
  currentRequestId,
  headersFromRecord,
  withRequestContext,
} from './requestContext';

describe('request context', () => {
  it('has no request ID outside a request', () => {
    expect(currentRequestId()).toBeUndefined();
  });

  it('uses the caller x-request-id first, then the platform ID', () => {
    expect(
      withRequestContext(
        new Headers({ 'x-request-id': 'req-1', 'x-vercel-id': 'iad1::abc' }),
        currentRequestId,
      ),
    ).toBe('req-1');
    expect(
      withRequestContext(
        new Headers({ 'x-vercel-id': 'iad1::abc' }),
        currentRequestId,
      ),
    ).toBe('iad1::abc');
  });

  it('makes an ID when the request carries none, or an unsafe one', () => {
    const uuid = /^[0-9a-f-]{36}$/;

    expect(withRequestContext(new Headers(), currentRequestId)).toMatch(uuid);
    expect(
      withRequestContext(
        new Headers({ 'x-request-id': 'a b\tc' }),
        currentRequestId,
      ),
    ).toMatch(uuid);
  });

  it('follows the request across awaits and does not leak to a parallel request', async () => {
    const run = (id: string) =>
      withRequestContext(new Headers({ 'x-request-id': id }), async () => {
        await Promise.resolve();
        await new Promise((resolve) =>
          setTimeout(resolve, id === 'slow' ? 10 : 0),
        );
        return currentRequestId();
      });

    const [slow, fast] = await Promise.all([run('slow'), run('fast')]);

    expect([slow, fast]).toEqual(['slow', 'fast']);
    expect(currentRequestId()).toBeUndefined();
  });
});

describe('headersFromRecord', () => {
  it('keeps the first of a repeated value and skips missing ones', () => {
    const headers = headersFromRecord({
      'x-request-id': ['first', 'second'],
      'x-other': undefined,
      accept: 'text/html',
    });

    expect(headers.get('x-request-id')).toBe('first');
    expect(headers.has('x-other')).toBe(false);
    expect(headers.get('accept')).toBe('text/html');
  });
});
