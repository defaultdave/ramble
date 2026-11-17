import { describe, expect, it } from 'vitest';
import {
  anonymousReviewer,
  reviewListLimit,
  reviewerName,
  reviewsView,
  type ReviewRow,
} from './reviewList';
import { nameClip } from './text';
import { id } from '../../tests/support/ids';

// Behaviours under test, one per decision, branch or risk:
// - below five reviews there is no block, and at five there is; the count is the aggregate's, not the rows given
// - at most ten are listed, newest first, whatever order they arrive in; a tie breaks by id
// - the mean reads to one place, and its stars are the mean rounded
// - the author is the booker's first name only, one line at most; no name reads "A guest"
// - a review's day is a New York calendar day, and its body keeps its paragraphs
// - nothing of the booker beyond the first name reaches the view

function row(n: number, overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: id(n),
    rating: 5,
    body: `Review ${String(n)}`,
    createdAt: new Date(Date.UTC(2026, 10, 1 + n, 15)),
    guestName: 'Noor Haddad',
    ...overrides,
  };
}

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => row(index + 1));

describe('reviewsView threshold', () => {
  it.each([
    { count: 0, shown: false },
    { count: 4, shown: false },
    { count: 5, shown: true },
    { count: 40, shown: true },
  ])(
    'with a count of $count the block is shown: $shown',
    ({ count, shown }) => {
      const view = reviewsView(
        { average: 4.2, count },
        rows(Math.min(count, 10)),
      );
      expect(view !== null).toBe(shown);
    },
  );

  it('is none without a rating, however many rows came', () => {
    expect(reviewsView(null, rows(10))).toBeNull();
  });
});

describe('reviewsView list', () => {
  it('lists at most the limit, newest first, whatever order they arrive in', () => {
    const view = reviewsView({ average: 4, count: 14 }, rows(14).toReversed());
    expect(view?.items).toHaveLength(reviewListLimit);
    expect(view?.items.map((item) => item.id)).toEqual(
      rows(14)
        .toReversed()
        .slice(0, reviewListLimit)
        .map((r) => r.id),
    );
  });

  it('lists every row when there are fewer than the limit', () => {
    expect(reviewsView({ average: 4, count: 6 }, rows(6))?.items).toHaveLength(
      6,
    );
  });

  it('breaks a tie in time by id, larger first, the same way each time', () => {
    const at = new Date(Date.UTC(2026, 10, 3, 15));
    const tied = [row(1, { createdAt: at }), row(2, { createdAt: at })];
    const forward = reviewsView({ average: 4, count: 5 }, tied);
    const backward = reviewsView({ average: 4, count: 5 }, tied.toReversed());
    expect(forward?.items.map((item) => item.id)).toEqual([id(2), id(1)]);
    expect(backward?.items).toEqual(forward?.items);
  });

  it('does not change the rows it was given', () => {
    const given = rows(12).toReversed();
    const copy = [...given];
    reviewsView({ average: 4, count: 12 }, given);
    expect(given).toEqual(copy);
  });
});

describe('reviewsView summary', () => {
  it.each([
    { average: 4.84, count: 12, text: '4.8', stars: 5 },
    { average: 4.46, count: 12, text: '4.5', stars: 4 },
    { average: 5, count: 5, text: '5.0', stars: 5 },
    { average: 3.5, count: 8, text: '3.5', stars: 4 },
    { average: 1, count: 5, text: '1.0', stars: 1 },
  ])('a mean of $average reads $text with $stars stars', (input) => {
    const view = reviewsView(
      { average: input.average, count: input.count },
      rows(5),
    );
    expect(view).toMatchObject({
      average: input.text,
      stars: input.stars,
      countLabel: `${String(input.count)} reviews`,
      spoken: `Rated ${input.text} out of 5 from ${String(input.count)} reviews`,
    });
  });
});

describe('reviewerName', () => {
  it.each([
    ['Noor Haddad', 'Noor'],
    ['  Noor   Haddad  ', 'Noor'],
    ['Noor', 'Noor'],
    ['Mary Jane Watson', 'Mary'],
    ['Zoë Ångström', 'Zoë'],
  ])('reads %j as %j', (name, expected) => {
    expect(reviewerName(name)).toBe(expected);
  });

  it.each([null, '', '   '])('reads %j as a guest', (name) => {
    expect(reviewerName(name)).toBe(anonymousReviewer);
  });

  it('cuts a very long first name to one line', () => {
    const name = reviewerName(`${'a'.repeat(300)} Surname`);
    expect(Array.from(name)).toHaveLength(nameClip.firstName);
    expect(name.endsWith('…')).toBe(true);
  });
});

describe('reviewsView items', () => {
  it('draws a New York day, so a late evening there is not the next day in UTC', () => {
    const view = reviewsView({ average: 5, count: 5 }, [
      row(1, { createdAt: new Date('2026-11-08T03:30:00Z') }),
    ]);
    expect(view?.items[0]?.dateLabel).toBe('Saturday, November 7, 2026');
  });

  it('splits the body into its paragraphs and drops blank lines', () => {
    const view = reviewsView({ average: 5, count: 5 }, [
      row(1, { body: 'First.\n\n  Second.  \n' }),
    ]);
    expect(view?.items[0]?.paragraphs).toEqual(['First.', 'Second.']);
  });

  it('carries the rating with a spoken form, and only the first name of the booker', () => {
    const view = reviewsView({ average: 4, count: 5 }, [
      row(1, { rating: 3, guestName: 'Noor Haddad' }),
    ]);
    expect(view?.items[0]).toEqual({
      id: id(1),
      rating: 3,
      ratingText: 'Rated 3 out of 5',
      author: 'Noor',
      dateLabel: expect.any(String) as string,
      paragraphs: ['Review 1'],
    });
    expect(JSON.stringify(view)).not.toContain('Haddad');
  });
});
