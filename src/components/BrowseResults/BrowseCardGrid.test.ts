import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Behaviours under test, one per decision, branch or risk:
// - the grid is a client component, which is what keeps the cards from being deferred server elements
//   (its rendering is covered through BrowseResults)

describe('BrowseCardGrid', () => {
  it('opens with the client directive', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, 'BrowseCardGrid.tsx'),
      'utf8',
    );

    expect(source.startsWith("'use client';")).toBe(true);
  });
});
