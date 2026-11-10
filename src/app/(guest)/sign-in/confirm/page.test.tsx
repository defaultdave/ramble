import { describe, expect, it } from 'vitest';
import { metadata } from './page';

// Behaviours under test:
// - the confirm page keeps the token out of the Referer with a policy that still lets the browser send a real Origin on the form post: `no-referrer` makes browsers send `Origin: null`, which the post refuses, so it must not be used
// - the page is kept out of search results

describe('the confirm page metadata', () => {
  it('asks for a referrer policy that is not no-referrer', () => {
    expect(metadata.referrer).toBe('origin');
    expect(metadata.referrer).not.toBe('no-referrer');
  });

  it('is not indexed or followed', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
