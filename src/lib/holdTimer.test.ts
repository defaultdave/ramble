import { describe, expect, it } from 'vitest';
import {
  holdAnnouncement,
  holdSecondsRemaining,
  holdTimerState,
  holdTimerText,
} from './holdTimer';

const now = new Date('2026-11-02T15:00:00.000Z');

function expiringIn(milliseconds: number): Date {
  return new Date(now.getTime() + milliseconds);
}

describe('holdSecondsRemaining', () => {
  it.each([
    { ms: 582_000, expected: 582 },
    { ms: 581_200, expected: 582 },
    { ms: 1, expected: 1 },
    { ms: 999, expected: 1 },
    { ms: 0, expected: 0 },
    { ms: -3_000, expected: 0 },
  ])('$ms ms left is $expected seconds', ({ ms, expected }) => {
    expect(holdSecondsRemaining(now, expiringIn(ms))).toBe(expected);
  });

  it.each([
    { name: 'an invalid expiry', now, expiresAt: new Date(Number.NaN) },
    { name: 'an invalid now', now: new Date(Number.NaN), expiresAt: now },
  ])('treats $name as expired', ({ now: from, expiresAt }) => {
    expect(holdSecondsRemaining(from, expiresAt)).toBe(0);
  });
});

describe('holdTimerState', () => {
  it.each([
    { ms: 600_000, expected: 'running' },
    { ms: 120_000, expected: 'running' },
    { ms: 119_000, expected: 'warning' },
    { ms: 1, expected: 'warning' },
    { ms: 0, expected: 'expired' },
    { ms: -5_000, expected: 'expired' },
  ])('$ms ms left is $expected', ({ ms, expected }) => {
    expect(holdTimerState(now, expiringIn(ms))).toBe(expected);
  });
});

describe('holdTimerText', () => {
  it.each([
    { ms: 582_000, expected: 'Spaces held for 9:42' },
    { ms: 72_000, expected: 'Spaces held for 1:12' },
    { ms: 600_000, expected: 'Spaces held for 10:00' },
    { ms: 59_900, expected: 'Spaces held for 1:00' },
    { ms: 400, expected: 'Spaces held for 0:01' },
    { ms: 0, expected: 'Hold expired' },
  ])('$ms ms left reads "$expected"', ({ ms, expected }) => {
    expect(holdTimerText(now, expiringIn(ms))).toBe(expected);
  });
});

describe('holdAnnouncement', () => {
  it.each([
    { ms: 600_000, expected: '' },
    { ms: 301_000, expected: '' },
    { ms: 300_000, expected: 'Your hold ends in 5 minutes.' },
    { ms: 121_000, expected: 'Your hold ends in 5 minutes.' },
    { ms: 120_000, expected: 'Your hold ends in 2 minutes.' },
    { ms: 400, expected: 'Your hold ends in 2 minutes.' },
    { ms: 0, expected: 'Your hold has expired.' },
  ])('$ms ms left says "$expected"', ({ ms, expected }) => {
    expect(holdAnnouncement(now, expiringIn(ms))).toBe(expected);
  });

  it('keeps one message while the clock ticks inside a band', () => {
    expect(holdAnnouncement(now, expiringIn(250_000))).toBe(
      holdAnnouncement(now, expiringIn(200_000)),
    );
  });
});

describe('look, text, and announcement agree', () => {
  it.each([
    { name: 'a fraction of a second left', expiresAt: expiringIn(400) },
    { name: 'an invalid expiry', expiresAt: new Date(Number.NaN) },
    { name: 'exactly expired', expiresAt: expiringIn(0) },
    { name: 'long ago', expiresAt: expiringIn(-60_000) },
  ])('$name', ({ expiresAt }) => {
    const expired = holdSecondsRemaining(now, expiresAt) === 0;
    expect(holdTimerState(now, expiresAt) === 'expired').toBe(expired);
    expect(holdTimerText(now, expiresAt) === 'Hold expired').toBe(expired);
    expect(holdAnnouncement(now, expiresAt) === 'Your hold has expired.').toBe(
      expired,
    );
  });
});
