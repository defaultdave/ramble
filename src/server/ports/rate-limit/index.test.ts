import { describe, expect, it, vi } from 'vitest';
import {
  maxSubjectLength,
  rateLimitKeyPattern,
  rateLimitPolicies,
  rateLimitSurfaces,
} from '@/lib/rateLimits';
import { consumeRateLimit, type ConsumeInput, type RateLimiter } from './index';

// The default adapter opens a database pool on import; these tests always pass their own limiter.
vi.mock('./postgres', () => ({ postgresRateLimiter: { consume: vi.fn() } }));

function recordingLimiter() {
  const calls: ConsumeInput[] = [];
  const limiter: RateLimiter = {
    consume: (input) => {
      calls.push(input);
      return Promise.resolve({ allowed: true, remaining: 1 });
    },
  };
  return { calls, limiter };
}

describe('consumeRateLimit', () => {
  it.each(rateLimitSurfaces)(
    'spends a try on the %s policy with a bounded, hashed key',
    async (surface) => {
      const { calls, limiter } = recordingLimiter();

      await consumeRateLimit(surface, 'guest@example.com', limiter);

      expect(calls).toHaveLength(1);
      const [call] = calls;
      expect(call?.limit).toBe(rateLimitPolicies[surface].limit);
      expect(call?.windowSeconds).toBe(
        rateLimitPolicies[surface].windowSeconds,
      );
      expect(call?.key).toMatch(new RegExp(rateLimitKeyPattern));
      expect(call?.key.startsWith(`${surface}:`)).toBe(true);
      expect(call?.key).not.toContain('guest@example.com');
    },
  );

  it('keeps the key the same length for the longest subject as for the shortest', async () => {
    const { calls, limiter } = recordingLimiter();

    await consumeRateLimit('forms', 'x', limiter);
    await consumeRateLimit('forms', 'x'.repeat(maxSubjectLength), limiter);

    expect(calls[0]?.key.length).toBe(calls[1]?.key.length);
  });

  it('counts spellings of one email together on sign-in links only', async () => {
    const { calls, limiter } = recordingLimiter();

    await consumeRateLimit('sign_in_link', 'Guest@Example.com', limiter);
    await consumeRateLimit('sign_in_link', ' guest@example.com ', limiter);
    await consumeRateLimit('forms', 'Guest@Example.com', limiter);
    await consumeRateLimit('forms', 'guest@example.com', limiter);

    expect(calls[0]?.key).toBe(calls[1]?.key);
    expect(calls[2]?.key).not.toBe(calls[3]?.key);
  });

  it('gives the same subject a separate counter on each surface', async () => {
    const { calls, limiter } = recordingLimiter();

    await consumeRateLimit('reserve', 'device-1', limiter);
    await consumeRateLimit('manage', 'device-1', limiter);

    expect(calls[0]?.key).not.toBe(calls[1]?.key);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['past the length cap', 'x'.repeat(maxSubjectLength + 1)],
  ])(
    'refuses a subject that is %s without touching the store',
    async (_n, subject) => {
      const { calls, limiter } = recordingLimiter();

      await expect(
        consumeRateLimit('forms', subject, limiter),
      ).rejects.toThrow();
      expect(calls).toHaveLength(0);
    },
  );

  it('returns the limiter refusal as it is', async () => {
    const limiter: RateLimiter = {
      consume: () => Promise.resolve({ allowed: false, retryAfterSeconds: 42 }),
    };

    await expect(consumeRateLimit('forms', 'a', limiter)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 42,
    });
  });

  it('fails closed when the store fails', async () => {
    const limiter: RateLimiter = {
      consume: () => Promise.reject(new Error('connection refused')),
    };

    await expect(consumeRateLimit('forms', 'a', limiter)).rejects.toThrow(
      'connection refused',
    );
  });
});
