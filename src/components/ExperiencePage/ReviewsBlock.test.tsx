import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewsBlock } from './ReviewsBlock';
import { reviewsFixture } from './ReviewsBlock.fixtures';

// Behaviours under test:
// - the summary says the mean and the count to a screen reader in one sentence, and shows them as text
// - one list item per review, in the order given, each with its first name, day, and words
// - a review's rating is spoken, and its stars are hidden from assistive tech
// - a review with no first name on record reads as a guest

describe('ReviewsBlock', () => {
  it('says the mean and the count once to a screen reader and shows them', () => {
    render(<ReviewsBlock view={reviewsFixture} />);
    expect(
      screen.getByText('Rated 4.6 out of 5 from 12 reviews'),
    ).toBeInTheDocument();
    expect(screen.getByText('4.6').parentElement).toHaveTextContent(
      '4.6 · 12 reviews',
    );
  });

  it('lists the reviews as the view orders them', () => {
    render(<ReviewsBlock view={reviewsFixture} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(reviewsFixture.items.length);
    const first = within(items[0] as HTMLElement);
    expect(first.getByText('Noor')).toBeInTheDocument();
    expect(first.getByText(/Gold light on the water/)).toBeInTheDocument();
    expect(first.getByText('Thursday, November 12, 2026')).toBeInTheDocument();
  });

  it('speaks each rating and hides the stars', () => {
    const { container } = render(<ReviewsBlock view={reviewsFixture} />);
    expect(screen.getAllByText('Rated 5 out of 5').length).toBeGreaterThan(0);
    expect(screen.getByText('Rated 4 out of 5')).toBeInTheDocument();
    for (const stars of container.querySelectorAll('svg')) {
      expect(stars.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('names a booker with no name a guest', () => {
    render(<ReviewsBlock view={reviewsFixture} />);
    expect(screen.getByText('A guest')).toBeInTheDocument();
  });

  it('shows no email, no sort control, no reply, and no more link', () => {
    render(<ReviewsBlock view={reviewsFixture} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });
});
