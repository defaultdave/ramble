import { describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('@/server/actions/reviews', () => ({ submitReviewForm: vi.fn() }));
vi.mock('@/server/reviewDraft', () => ({ readReviewDraft: vi.fn() }));
vi.mock('@/server/reviewForm', () => ({ readReviewPage: vi.fn() }));

const { metadata } = await import('./page');

// Behaviours under test:
// - the page keeps the link's token out of the Referer with a policy that still lets the browser
//   send a real Origin on the form post: `no-referrer` makes browsers send `Origin: null`, which a
//   Server Action refuses, so the form would fail with scripting off
// - the page is kept out of search results and unfurls to nothing

describe('the review page metadata', () => {
  it('asks for a referrer policy that is not no-referrer', () => {
    expect(metadata.referrer).toBe('origin');
    expect(metadata.referrer).not.toBe('no-referrer');
  });

  it('is not indexed and has nothing to unfurl', () => {
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
    });
    expect(metadata.description).toBeNull();
    expect(metadata.openGraph).toBeNull();
    expect(metadata.twitter).toBeNull();
  });
});
