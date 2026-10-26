import { describe, expect, it, vi } from 'vitest';
import { currentRequestId, withRequestContext } from './requestContext';

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
    const local = /^local-[a-z0-9]+-[a-z0-9]+$/;

    expect(withRequestContext(new Headers(), currentRequestId)).toMatch(local);
    expect(
      withRequestContext(
        new Headers({ 'x-request-id': 'a b\tc' }),
        currentRequestId,
      ),
    ).toMatch(local);
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

describe('request headers as a plain record', () => {
  it('reads the IDs by name, taking the first of a repeated value', () => {
    expect(
      withRequestContext(
        { 'x-request-id': ['first', 'second'] },
        currentRequestId,
      ),
    ).toBe('first');
    expect(
      withRequestContext({ 'x-vercel-id': 'iad1::abc' }, currentRequestId),
    ).toBe('iad1::abc');
  });

  it('copes with HTTP/2 pseudo-headers, which a Headers object refuses', () => {
    expect(() => {
      new Headers().set(':authority', 'ramble.example');
    }).toThrow();

    expect(
      withRequestContext(
        {
          ':authority': 'ramble.example',
          ':path': '/x',
          'x-request-id': 'req-9',
        },
        currentRequestId,
      ),
    ).toBe('req-9');
  });

  it('makes an ID when nothing usable arrives', () => {
    expect(withRequestContext({}, currentRequestId)).toMatch(/^local-/);
    expect(
      withRequestContext({ 'x-request-id': undefined }, currentRequestId),
    ).toMatch(/^local-/);
  });
});

describe('IDs made when a request carries none', () => {
  it('are unique across many requests and valid as request IDs', () => {
    const ids = Array.from({ length: 1_000 }, () =>
      withRequestContext(new Headers(), currentRequestId),
    );

    expect(new Set(ids).size).toBe(1_000);
    for (const id of ids)
      expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
  });

  it('do not use the random sources Next.js flags while it prerenders', () => {
    const random = vi.spyOn(Math, 'random');
    const uuid = vi.spyOn(crypto, 'randomUUID');
    const values = vi.spyOn(crypto, 'getRandomValues');

    withRequestContext(new Headers(), currentRequestId);

    expect(random).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
