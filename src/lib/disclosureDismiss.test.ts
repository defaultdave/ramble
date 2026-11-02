import { describe, expect, it } from 'vitest';
import { dismissAction, type DismissEvent } from './disclosureDismiss';

// Behaviours under test, one per decision:
// - Escape on an open disclosure closes it and returns focus to the summary
// - a press outside an open disclosure closes it without moving focus
// - a press inside an open disclosure leaves it open
// - a closed disclosure ignores both

describe('dismissAction', () => {
  it.each<[string, DismissEvent, string]>([
    [
      'Escape while open',
      { kind: 'escape', open: true, inside: true },
      'close-and-refocus',
    ],
    [
      'press outside while open',
      { kind: 'press', open: true, inside: false },
      'close',
    ],
    [
      'press inside while open',
      { kind: 'press', open: true, inside: true },
      'none',
    ],
    [
      'Escape while closed',
      { kind: 'escape', open: false, inside: true },
      'none',
    ],
    [
      'press outside while closed',
      { kind: 'press', open: false, inside: false },
      'none',
    ],
  ])('%s', (_name, event, expected) => {
    expect(dismissAction(event)).toBe(expected);
  });
});
