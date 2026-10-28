// Deterministic ids and numbers for the seed. A seeded row keeps the same id on every run, which is
// what lets a rerun update it in place and lets a fixture point at another by name.

const maxKeyLength = 200;

/** Four 32-bit words from a string (cyrb128). Not cryptographic; it only has to spread keys evenly. */
function hashWords(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

const hex = (word: number) => word.toString(16).padStart(8, '0');

/**
 * A UUID shaped id (version 4 and variant bits set) that depends only on the namespace and the
 * key. The namespace keeps a host and an experience with the same slug apart.
 */
export function seedId(namespace: string, key: string): string {
  if (namespace.length > maxKeyLength || key.length > maxKeyLength) {
    throw new RangeError(
      `A seed id is made from a namespace and key of at most ${String(maxKeyLength)} characters`,
    );
  }
  const digits = hashWords(`${namespace}\u0000${key}`).map(hex).join('');
  const variant = ((parseInt(digits.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    digits.slice(0, 8),
    digits.slice(8, 12),
    `4${digits.slice(13, 16)}`,
    `${variant}${digits.slice(17, 20)}`,
    digits.slice(20, 32),
  ].join('-');
}

export const maxSeedValue = 0xffff_ffff;

export type Random = {
  /** A number from 0 up to, not including, 1. */
  next: () => number;
  /** A whole number from `min` to `max`, both included. */
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  /** True with the given chance, from 0 to 1. */
  chance: (probability: number) => boolean;
  /** One entry, chosen in proportion to its weight. */
  weighted: <T>(entries: readonly (readonly [T, number])[]) => T;
};

/** A repeatable stream of numbers (mulberry32). The same seed always gives the same stream. */
export function createRandom(seed: number): Random {
  if (!Number.isInteger(seed) || seed < 0 || seed > maxSeedValue) {
    throw new RangeError(
      `A seed is a whole number from 0 to ${String(maxSeedValue)}`,
    );
  }
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    const item = items[int(0, items.length - 1)];
    if (item === undefined) throw new RangeError('Nothing to pick from');
    return item;
  };
  const chance = (probability: number) => next() < probability;
  const weighted = <T>(entries: readonly (readonly [T, number])[]): T => {
    let total = 0;
    for (const [, weight] of entries) total += weight;
    let roll = next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    const last = entries.at(-1);
    if (!last) throw new RangeError('Nothing to pick from');
    return last[0];
  };
  return { next, int, pick, chance, weighted };
}
