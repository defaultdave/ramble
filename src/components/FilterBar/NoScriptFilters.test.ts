import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Behaviours under test, one per decision, branch or risk:
// - the no-script filters are a client component, which is what keeps the server from streaming their
//   chips as templates inside the <noscript>, where the swap script throws (their rendering is covered
//   through FilterBar)

describe('NoScriptFilters', () => {
  it('opens with the client directive', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, 'NoScriptFilters.tsx'),
      'utf8',
    );

    expect(source.startsWith("'use client';")).toBe(true);
  });
});
