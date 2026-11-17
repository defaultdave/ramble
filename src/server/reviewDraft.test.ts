import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(jar) }));

import {
  forgetReviewDraft,
  keepReviewDraft,
  readReviewDraft,
} from './reviewDraft';

// Behaviours under test:
// - a kept draft is the booker's own cookie: http only, secure, scoped to the review pages, gone in minutes
// - a draft too large for a cookie is not written
// - a draft is read back for its own order only, and none is none
// - forgetting a draft deletes the cookie at the same path it was set on

const reference = 'RMB-7K3M9Q';

beforeEach(() => {
  jar.get.mockReset();
  jar.set.mockReset();
  jar.delete.mockReset();
});

describe('keepReviewDraft', () => {
  it('writes the draft as a short-lived cookie that scripts cannot read, on the review pages only', async () => {
    await keepReviewDraft({ reference, rating: 4, body: 'Lovely' });
    expect(jar.set).toHaveBeenCalledExactlyOnceWith(
      'ramble_review_draft',
      `${reference}|4|Lovely`,
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/review',
        maxAge: 600,
      },
    );
  });

  it('writes nothing for a draft that would not fit in a cookie', async () => {
    await keepReviewDraft({ reference, rating: 4, body: '🙂'.repeat(2000) });
    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe('readReviewDraft', () => {
  it('reads the draft for its own order', async () => {
    jar.get.mockReturnValue({ value: `${reference}|5|Great` });
    expect(await readReviewDraft(reference)).toEqual({
      reference,
      rating: 5,
      body: 'Great',
    });
  });

  it.each([
    ['no cookie', undefined],
    ['a draft for another order', { value: 'RMB-2H4J6N|5|Great' }],
  ])('reads none for %s', async (_label, stored) => {
    jar.get.mockReturnValue(stored);
    expect(await readReviewDraft(reference)).toBeNull();
  });
});

describe('forgetReviewDraft', () => {
  it('deletes the cookie at the path it was set on', async () => {
    await forgetReviewDraft();
    expect(jar.delete).toHaveBeenCalledExactlyOnceWith({
      name: 'ramble_review_draft',
      path: '/review',
    });
  });
});
