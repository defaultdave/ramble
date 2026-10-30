import { describe, expect, it } from 'vitest';
import { isPrerenderEnd } from './prerender';

// Behaviours under test:
// - the framework's prerender-end error is recognised, bare or wrapped by a driver error
// - the search is bounded: a deep chain, a cycle, and values that are not errors end it
// - an ordinary failure is not mistaken for it

const ended = new Error(
  'During prerendering, fetch() rejects when the prerender is complete.',
);

describe('isPrerenderEnd', () => {
  it('recognises the error itself', () => {
    expect(isPrerenderEnd(ended)).toBe(true);
  });

  it('recognises it under one or two wrappers', () => {
    const once = new Error('Failed query: select 1', { cause: ended });
    const twice = new Error('Error connecting to database', { cause: once });
    expect(isPrerenderEnd(once)).toBe(true);
    expect(isPrerenderEnd(twice)).toBe(true);
  });

  it.each([
    ['an ordinary error', new Error('connection refused')],
    [
      'an error with an ordinary cause',
      new Error('x', { cause: new Error('y') }),
    ],
    ['a string', 'During prerendering,'],
    ['nothing', undefined],
  ])('does not take %s for it', (_name, value) => {
    expect(isPrerenderEnd(value)).toBe(false);
  });

  it('stops looking after a few wrappers', () => {
    let deep: Error = ended;
    for (let i = 0; i < 6; i += 1) deep = new Error('wrapper', { cause: deep });
    expect(isPrerenderEnd(deep)).toBe(false);
  });

  it('ends on a cycle of causes', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    expect(isPrerenderEnd(a)).toBe(false);
  });
});
