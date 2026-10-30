import { describe, expect, it } from 'vitest';
import { fixedClock, systemClock } from './index';

// Behaviours under test:
// - the system clock reports the real time, as a new Date each call
// - a fixed clock always reports the instant it was given
// - changing a Date a fixed clock returned does not change what it reports next
// - a fixed clock is not changed by changing the Date it was built from

describe('systemClock', () => {
  it('reports the real time', () => {
    const before = performance.timeOrigin + performance.now();

    const reported = systemClock.now().getTime();

    expect(Math.abs(reported - before)).toBeLessThan(5000);
  });

  it('returns a new Date each call', () => {
    expect(systemClock.now()).not.toBe(systemClock.now());
  });
});

describe('fixedClock', () => {
  const at = new Date('2026-12-01T10:00:00.000Z');

  it('always reports the same instant', () => {
    const clock = fixedClock(at);

    expect(clock.now()).toEqual(at);
    expect(clock.now()).toEqual(at);
  });

  it('is not changed by mutating a returned Date', () => {
    const clock = fixedClock(at);
    clock.now().setUTCFullYear(2030);

    expect(clock.now()).toEqual(at);
  });

  it('is not changed by mutating the Date it was built from', () => {
    const source = new Date(at);
    const clock = fixedClock(source);
    source.setUTCFullYear(2030);

    expect(clock.now()).toEqual(at);
  });
});
