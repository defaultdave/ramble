import { describe, expect, it } from 'vitest';
import {
  ConsumeInputSchema,
  maxLimit,
  maxSubjectLength,
  maxWindowSeconds,
  rateLimitKeyPattern,
  RateLimitKeySchema,
  rateLimitPolicies,
  rateLimitSurfaces,
  decideRateLimit,
  normalizeSubject,
} from './rateLimits';

const digest = 'a'.repeat(64);

describe('rateLimitPolicies', () => {
  it.each(rateLimitSurfaces)(
    '%s has a limit and window the consume schema accepts',
    (surface) => {
      const { limit, windowSeconds } = rateLimitPolicies[surface];

      expect(
        ConsumeInputSchema.safeParse({
          key: `${surface}:${digest}`,
          limit,
          windowSeconds,
        }).success,
      ).toBe(true);
    },
  );

  it('allows five payment tries per hold, for longer than a hold lives', () => {
    expect(rateLimitPolicies.payment_tries.limit).toBe(5);
    expect(rateLimitPolicies.payment_tries.windowSeconds).toBeGreaterThan(
      15 * 60,
    );
  });

  it.each([
    ['sign_in_link', '  Guest@Example.COM ', 'guest@example.com'],
    ['reserve', '  device-1 ', 'device-1'],
    ['forms', ' Contact:abc ', 'Contact:abc'],
  ] as const)('%s reads %j as %j', (surface, subject, expected) => {
    expect(rateLimitPolicies[surface].normalizeSubject(subject)).toBe(expected);
  });
});

describe('RateLimitKeySchema', () => {
  it.each([
    `sign_in_link:${digest}`,
    `forms:${digest}`,
    `a:${'0123456789abcdef'.repeat(4)}`,
  ])('accepts %s', (key) => {
    expect(RateLimitKeySchema.safeParse(key).success).toBe(true);
  });

  it.each([
    ['no digest', 'forms'],
    ['short digest', `forms:${'a'.repeat(63)}`],
    ['long digest', `forms:${'a'.repeat(65)}`],
    ['upper-case digest', `forms:${'A'.repeat(64)}`],
    ['upper-case surface', `Forms:${digest}`],
    ['surface with a hyphen', `sign-in:${digest}`],
    ['empty surface', `:${digest}`],
    ['surface starting with an underscore', `_forms:${digest}`],
    ['surface of 33 letters', `${'a'.repeat(33)}:${digest}`],
    ['trailing newline', `forms:${digest}\n`],
    ['a raw email', 'forms:guest@example.com'],
    ['too long', `${'a'.repeat(300)}:${digest}`],
  ])('refuses %s', (_name, key) => {
    expect(RateLimitKeySchema.safeParse(key).success).toBe(false);
  });

  it('is the pattern the database CHECK spells', () => {
    expect(rateLimitKeyPattern).toBe(
      String.raw`^[a-z][a-z_]{0,31}:[0-9a-f]{64}$`,
    );
  });
});

describe('ConsumeInputSchema', () => {
  const valid = { key: `forms:${digest}`, limit: 5, windowSeconds: 60 };

  it.each([
    ['limit 0', { limit: 0 }],
    ['limit past the cap', { limit: maxLimit + 1 }],
    ['fractional limit', { limit: 2.5 }],
    ['window 0', { windowSeconds: 0 }],
    ['window past a day', { windowSeconds: maxWindowSeconds + 1 }],
    ['fractional window', { windowSeconds: 1.5 }],
    ['infinite window', { windowSeconds: Infinity }],
  ])('refuses %s', (_name, override) => {
    expect(
      ConsumeInputSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });
});

describe('normalizeSubject', () => {
  it.each(rateLimitSurfaces)(
    '%s refuses a subject that is empty once normalized',
    (surface) => {
      expect(() => normalizeSubject(surface, '')).toThrow();
      expect(() => normalizeSubject(surface, '   ')).toThrow();
      expect(() => normalizeSubject(surface, '\t\n')).toThrow();
    },
  );

  it('bounds the raw subject before normalizing it', () => {
    expect(() =>
      normalizeSubject('forms', 'x'.repeat(maxSubjectLength + 1)),
    ).toThrow();
    expect(
      normalizeSubject('forms', 'x'.repeat(maxSubjectLength)),
    ).toHaveLength(maxSubjectLength);
  });

  it('returns the policy spelling', () => {
    expect(normalizeSubject('sign_in_link', ' Guest@Example.COM ')).toBe(
      'guest@example.com',
    );
    expect(normalizeSubject('reserve', ' Device-1 ')).toBe('Device-1');
  });
});

describe('decideRateLimit', () => {
  it.each([
    [1, 3, { allowed: true, remaining: 2 }],
    [3, 3, { allowed: true, remaining: 0 }],
    [4, 3, { allowed: false, retryAfterSeconds: 9 }],
    [1, 1, { allowed: true, remaining: 0 }],
    [2, 1, { allowed: false, retryAfterSeconds: 9 }],
  ])('count %i against limit %i', (count, limit, expected) => {
    expect(decideRateLimit({ count, limit, retryAfterSeconds: 9 })).toEqual(
      expected,
    );
  });
});
