import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ submitReview: vi.fn() }));

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

import { submitReviewForm } from './reviews';

// Behaviours under test:
// - a form with no usable reference or token is the not-found page, and nothing is written
// - a bad rating or body goes back to the form with the fields named, and nothing is written
// - a good form is submitted once with the trimmed values, and the booker lands on the page, with done only for a created review
// - every other answer lands on the bare page, which says what is true of the booking

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
});
