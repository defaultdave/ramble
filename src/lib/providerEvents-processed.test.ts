import { describe, expect, it } from 'vitest';
import { isEventProcessed } from './providerEvents';

// Behaviours under test: an event with a processing time is finished (a repeat of its job does nothing), one without is not.

describe('isEventProcessed', () => {
  it.each([
    [null, false],
    [new Date('2026-11-10T12:00:00Z'), true],
  ])('is decided by the processing time %s', (processedAt, expected) => {
    expect(isEventProcessed({ processedAt })).toBe(expected);
  });
});
