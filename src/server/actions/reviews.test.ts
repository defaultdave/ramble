import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  submitReview: vi.fn(),
  keepReviewDraft: vi.fn(),
  forgetReviewDraft: vi.fn(),
}));

class Redirected extends Error {
  constructor(readonly href: string) {
    super(href);
  }
}
class NotFound extends Error {}

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Redirected(href);
  },
  notFound: () => {
    throw new NotFound();
  },
}));
vi.mock('@/server/reviewForm', () => ({ submitReview: mocks.submitReview }));
vi.mock('@/server/reviewDraft', () => ({
  keepReviewDraft: mocks.keepReviewDraft,
  forgetReviewDraft: mocks.forgetReviewDraft,
}));

import { submitReviewForm } from './reviews';

// Behaviours under test:
// - a form with no usable reference or token is the not-found page, and nothing is written
// - a bad rating or body goes back to the form with the fields named, and nothing is written
// - a good form is submitted once with the trimmed values, and the booker lands on the page, with done only for a created review
// - every other answer lands on the bare page, which says what is true of the booking
// - what the booker typed is kept for the retry after a bad field and after a wait, ended once a review is made, and left alone otherwise; a form with no usable link keeps nothing

const reference = 'RMB-7K3M9Q';
const token = 'A'.repeat(43);
const page = `/review/${reference}/${token}`;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function outcome(data: FormData): Promise<string> {
  try {
    await submitReviewForm(data);
  } catch (error) {
    if (error instanceof Redirected) return error.href;
    if (error instanceof NotFound) return 'not-found';
    throw error;
  }
  throw new Error('did not leave the action');
}

beforeEach(() => {
  mocks.submitReview.mockReset().mockResolvedValue('created');
  mocks.keepReviewDraft.mockReset().mockResolvedValue(undefined);
  mocks.forgetReviewDraft.mockReset().mockResolvedValue(undefined);
});

describe('submitReviewForm', () => {
  it.each([
    ['no reference', { token, rating: '5', body: 'Great' }],
    ['no token', { reference, rating: '5', body: 'Great' }],
    [
      'a malformed token',
      { reference, token: 'x', rating: '5', body: 'Great' },
    ],
  ])('is the not-found page for %s, and writes nothing', async (_l, fields) => {
    expect(await outcome(form(fields))).toBe('not-found');
    expect(mocks.submitReview).not.toHaveBeenCalled();
  });

  it.each([
    [{ rating: '', body: 'Great' }, 'rating'],
    [{ rating: '9', body: 'Great' }, 'rating'],
    [{ rating: '5', body: '   ' }, 'body'],
    [{ rating: '', body: '' }, 'rating,body'],
  ])(
    'goes back to the form naming the fields for %j, and writes nothing',
    async (fields, named) => {
      expect(await outcome(form({ reference, token, ...fields }))).toBe(
        `${page}?problem=${named}`,
      );
      expect(mocks.submitReview).not.toHaveBeenCalled();
    },
  );

  it('submits a good form once with the trimmed values and lands on the page with done', async () => {
    expect(
      await outcome(
        form({ reference, token, rating: '4', body: '  Lovely evening.  ' }),
      ),
    ).toBe(`${page}?done=1`);
    expect(mocks.submitReview).toHaveBeenCalledExactlyOnceWith({
      reference,
      token,
      rating: 4,
      body: 'Lovely evening.',
    });
  });

  it.each([
    'already_reviewed',
    'expired',
    'not_found',
    'rate_limited',
    'invalid',
  ])('lands on the bare page when the answer is %s', async (status) => {
    mocks.submitReview.mockResolvedValue(status);
    expect(
      await outcome(form({ reference, token, rating: '4', body: 'Lovely' })),
    ).toBe(page);
  });

  it('keeps what was typed when a field was bad, so the form comes back filled in', async () => {
    await outcome(form({ reference, token, rating: '4', body: '   ' }));
    expect(mocks.keepReviewDraft).toHaveBeenCalledExactlyOnceWith({
      reference,
      rating: 4,
      body: '   ',
    });
    expect(mocks.forgetReviewDraft).not.toHaveBeenCalled();
  });

  it('keeps what was typed when the link was told to wait', async () => {
    mocks.submitReview.mockResolvedValue('rate_limited');
    await outcome(form({ reference, token, rating: '4', body: 'Lovely' }));
    expect(mocks.keepReviewDraft).toHaveBeenCalledExactlyOnceWith({
      reference,
      rating: 4,
      body: 'Lovely',
    });
  });

  it('ends the kept draft when the review is made', async () => {
    await outcome(form({ reference, token, rating: '4', body: 'Lovely' }));
    expect(mocks.forgetReviewDraft).toHaveBeenCalledTimes(1);
    expect(mocks.keepReviewDraft).not.toHaveBeenCalled();
  });

  it.each(['already_reviewed', 'expired', 'not_found'])(
    'leaves the kept draft alone when the answer is %s',
    async (status) => {
      mocks.submitReview.mockResolvedValue(status);
      await outcome(form({ reference, token, rating: '4', body: 'Lovely' }));
      expect(mocks.keepReviewDraft).not.toHaveBeenCalled();
      expect(mocks.forgetReviewDraft).not.toHaveBeenCalled();
    },
  );

  it('keeps nothing for a form with no usable link', async () => {
    await outcome(form({ token, rating: '5', body: 'Great' }));
    expect(mocks.keepReviewDraft).not.toHaveBeenCalled();
  });
});
