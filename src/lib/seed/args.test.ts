import { describe, expect, it } from 'vitest';
import {
  defaultScaleExperiences,
  defaultScaleSeed,
  maxScaleExperiences,
  parseSeedArgs,
} from './args';
import { maxSeedValue } from './ids';

// Behaviours under test:
// - no arguments seeds the curated set only
// - --scale alone asks for the default 400 with the default seed; --scale=N and --scale-seed=N set them
// - the count is bounded at 1 to the maximum and the seed at 0 to 2^32 - 1, ends included
// - anything unknown, malformed, signed, or fractional is refused; a seed with no --scale is refused

describe('parseSeedArgs', () => {
  it('seeds the curated set by default', () => {
    expect(parseSeedArgs([])).toEqual({ ok: true, scale: undefined });
  });

  it('uses 400 experiences and the default seed for a bare --scale', () => {
    expect(parseSeedArgs(['--scale'])).toEqual({
      ok: true,
      scale: { experiences: defaultScaleExperiences, seed: defaultScaleSeed },
    });
  });

  it('reads a count and a seed', () => {
    expect(parseSeedArgs(['--scale=25', '--scale-seed=9'])).toEqual({
      ok: true,
      scale: { experiences: 25, seed: 9 },
    });
  });

  it('reads the options in either order', () => {
    expect(parseSeedArgs(['--scale-seed=9', '--scale=25'])).toEqual({
      ok: true,
      scale: { experiences: 25, seed: 9 },
    });
  });

  it.each([
    [`--scale=1`, 1],
    [`--scale=${String(maxScaleExperiences)}`, maxScaleExperiences],
  ])('accepts the bound in %s', (arg, experiences) => {
    expect(parseSeedArgs([arg])).toMatchObject({
      ok: true,
      scale: { experiences },
    });
  });

  it.each([
    '--scale=0',
    `--scale=${String(maxScaleExperiences + 1)}`,
    '--scale=-5',
    '--scale=2.5',
    '--scale=',
    '--scale=abc',
    '--scale=99999999999',
    `--scale-seed=${String(maxSeedValue + 1)}`,
    '--scale-seed=-1',
    '--scale-seed=',
    '--production',
    'scale',
    '--scale-seed',
  ])('refuses %s', (arg) => {
    expect(parseSeedArgs(['--scale', arg]).ok).toBe(false);
  });

  it('accepts the largest seed', () => {
    expect(
      parseSeedArgs(['--scale', `--scale-seed=${String(maxSeedValue)}`]),
    ).toMatchObject({ ok: true, scale: { seed: maxSeedValue } });
  });

  it('refuses a seed with no --scale', () => {
    const result = parseSeedArgs(['--scale-seed=3']);
    expect(result.ok).toBe(false);
  });
});
