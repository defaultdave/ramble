import { describe, expect, it } from 'vitest';
import { createRandom, maxSeedValue, seedId } from './ids';

// Behaviours under test:
// - an id depends only on its namespace and key, and looks like a version 4 uuid
// - the namespace keeps equal keys apart; ten thousand keys never collide
// - a key or namespace past the bound is refused
// - a seeded stream repeats exactly, differs between seeds, and stays inside its bounds
// - a seed outside 0 to 2^32 - 1 or not whole is refused
// - weighted picks follow the weights, and a zero weight is never chosen

describe('seedId', () => {
  it('is the same for the same namespace and key', () => {
    expect(seedId('host', 'hudson-paddle-club')).toBe(
      seedId('host', 'hudson-paddle-club'),
    );
  });

  it('has the shape of a version 4 uuid', () => {
    expect(seedId('experience', 'a')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('keeps the same key apart across namespaces', () => {
    expect(seedId('host', 'x')).not.toBe(seedId('experience', 'x'));
  });

  it('does not collide across ten thousand keys', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) ids.add(seedId('scale', String(i)));
    expect(ids.size).toBe(10_000);
  });

  it.each([
    ['namespace', 'n'.repeat(201), 'k'],
    ['key', 'n', 'k'.repeat(201)],
  ])('refuses a %s past the bound', (_name, namespace, key) => {
    expect(() => seedId(namespace, key)).toThrow(RangeError);
  });
});

describe('createRandom', () => {
  it('repeats exactly for one seed', () => {
    const a = createRandom(7);
    const b = createRandom(7);
    expect([a.next(), a.next(), a.next()]).toEqual([
      b.next(),
      b.next(),
      b.next(),
    ]);
  });

  it('differs between seeds', () => {
    expect(createRandom(1).next()).not.toBe(createRandom(2).next());
  });

  it('keeps next in [0, 1) and int inside its bounds, ends included', () => {
    const random = createRandom(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      seen.add(random.int(3, 5));
    }
    expect([...seen].sort()).toEqual([3, 4, 5]);
  });

  it.each([-1, 1.5, maxSeedValue + 1, Number.NaN])(
    'refuses the seed %s',
    (seed) => {
      expect(() => createRandom(seed)).toThrow(RangeError);
    },
  );

  it('accepts the largest seed', () => {
    expect(() => createRandom(maxSeedValue)).not.toThrow();
  });

  it('chooses by weight and never takes a zero weight', () => {
    const random = createRandom(5);
    const counts = { often: 0, rarely: 0, never: 0 };
    for (let i = 0; i < 4000; i += 1) {
      counts[
        random.weighted([
          ['often', 9],
          ['rarely', 1],
          ['never', 0],
        ] as const)
      ] += 1;
    }
    expect(counts.never).toBe(0);
    expect(counts.often).toBeGreaterThan(counts.rarely * 5);
  });

  it('refuses to pick from nothing', () => {
    expect(() => createRandom(1).pick([])).toThrow(RangeError);
    expect(() => createRandom(1).weighted([])).toThrow(RangeError);
  });

  it('picks the chance branch by probability', () => {
    const random = createRandom(3);
    expect(random.chance(0)).toBe(false);
    expect(random.chance(1)).toBe(true);
  });
});
