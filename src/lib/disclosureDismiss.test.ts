import { describe, expect, it } from 'vitest';
import { dismissAction, type DismissEvent } from './disclosureDismiss';

// Behaviours under test, one per decision:
// - Escape on an open disclosure closes it and returns focus to the summary
// - a press outside an open disclosure closes it without moving focus
// - a press inside an open disclosure leaves it open
// - focus moving to an element outside an open disclosure closes it; focus moving inside, or to nothing known, leaves it open
// - a link clicked inside an open disclosure closes it
// - a closed disclosure ignores all of them

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
    [
      'focus out to an outside element while open',
      { kind: 'focus-out', open: true, inside: false },
      'close',
    ],
    [
      'focus moving within while open',
      { kind: 'focus-out', open: true, inside: true },
      'none',
    ],
    [
      'focus going to nothing known while open',
      { kind: 'focus-out', open: true, inside: null },
      'none',
    ],
    [
      'focus out while closed',
      { kind: 'focus-out', open: false, inside: false },
      'none',
    ],
    [
      'link click while open',
      { kind: 'link-click', open: true, inside: true },
      'close',
    ],
    [
      'link click while closed',
      { kind: 'link-click', open: false, inside: true },
      'none',
    ],
  ])('%s', (_name, event, expected) => {
    expect(dismissAction(event)).toBe(expected);
  });
});
