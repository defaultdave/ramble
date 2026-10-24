import { describe, expect, it } from 'vitest';
import {
  formatHoldTime,
  holdAnnouncement,
  holdTimerState,
  holdTimerText,
} from './holdTimer';

describe('holdTimerState', () => {
  it.each([
    { seconds: 600, expected: 'running' },
    { seconds: 120, expected: 'running' },
    { seconds: 119, expected: 'warning' },
    { seconds: 1, expected: 'warning' },
    { seconds: 0, expected: 'expired' },
    { seconds: -5, expected: 'expired' },
  ])('$seconds seconds is $expected', ({ seconds, expected }) => {
    expect(holdTimerState(seconds)).toBe(expected);
  });
});

describe('formatHoldTime', () => {
  it.each([
    { seconds: 582, expected: '9:42' },
    { seconds: 72, expected: '1:12' },
    { seconds: 600, expected: '10:00' },
    { seconds: 59.9, expected: '0:59' },
    { seconds: 0, expected: '0:00' },
    { seconds: -3, expected: '0:00' },
  ])('$seconds seconds reads $expected', ({ seconds, expected }) => {
    expect(formatHoldTime(seconds)).toBe(expected);
  });
});

describe('holdTimerText', () => {
  it.each([
    { seconds: 582, expected: 'Spaces held for 9:42' },
    { seconds: 72, expected: 'Spaces held for 1:12' },
    { seconds: 0, expected: 'Hold expired' },
  ])('$seconds seconds reads "$expected"', ({ seconds, expected }) => {
    expect(holdTimerText(seconds)).toBe(expected);
  });
});

describe('holdAnnouncement', () => {
  it.each([
    { seconds: 600, expected: '' },
    { seconds: 301, expected: '' },
    { seconds: 300, expected: 'Your hold ends in 5 minutes.' },
    { seconds: 121, expected: 'Your hold ends in 5 minutes.' },
    { seconds: 120, expected: 'Your hold ends in 2 minutes.' },
    { seconds: 1, expected: 'Your hold ends in 2 minutes.' },
    { seconds: 0, expected: 'Your hold has expired.' },
  ])('$seconds seconds says "$expected"', ({ seconds, expected }) => {
    expect(holdAnnouncement(seconds)).toBe(expected);
  });

  it('keeps one message while the clock ticks inside a band', () => {
    expect(holdAnnouncement(250)).toBe(holdAnnouncement(200));
  });
});
