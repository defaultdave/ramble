import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewModeration } from './ReviewModeration';
import { hiddenRow, visibleRow } from './ReviewModeration.fixtures';

// Behaviours under test:
// - each review shows its experience, rating, body, first name and status in words
// - a visible review has a hide form carrying its id, with a required reason choice and a Hide button named for the review's author and experience
// - a hidden review has a show-again form carrying its id, named for the review, and no reason choice
// - the status filter links to the list by status, and an empty list says so

const noop = () => undefined;

function renderList(rows = [visibleRow, hiddenRow]) {
  return render(
    <ReviewModeration
      rows={rows}
      query={{}}
      cursor={null}
      nextCursor={null}
      hide={noop}
      unhide={noop}
    />,
  );
}

describe('ReviewModeration', () => {
  it('shows the experience, rating, body, first name and status of each review', () => {
    renderList();
    const visible = screen.getByRole('row', { name: /Pottery wheel night/ });
    expect(within(visible).getByText('4 out of 5')).toBeInTheDocument();
    expect(within(visible).getByText(/two bowls/)).toBeInTheDocument();
    expect(within(visible).getByText('Pat')).toBeInTheDocument();
    expect(within(visible).getByText('Visible')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Sunrise kayak/ })).getByText(
        'Hidden',
      ),
    ).toBeInTheDocument();
  });

  it('offers a hide form with a required reason on a visible review only', () => {
    const { container } = renderList([visibleRow]);
    expect(container.querySelector('input[name="id"]')).toHaveValue(
      visibleRow.id,
    );
    expect(
      screen.getByLabelText(
        'Reason for hiding the review by Pat, Pottery wheel night',
      ),
    ).toBeRequired();
    expect(
      screen.getByRole('button', {
        name: 'Hide review by Pat, Pottery wheel night',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show again/ })).toBeNull();
  });

  it('offers show again, with no reason, on a hidden review', () => {
    const { container } = renderList([hiddenRow]);
    expect(container.querySelector('input[name="id"]')).toHaveValue(
      hiddenRow.id,
    );
    expect(container.querySelector('select')).toBeNull();
    expect(
      screen.getByRole('button', {
        name: 'Show again the review by A guest, Sunrise kayak paddle',
      }),
    ).toBeInTheDocument();
  });

  it('filters by status with links', () => {
    renderList();
    const filter = screen.getByRole('navigation', {
      name: 'Filter reviews by status',
    });
    expect(
      within(filter).getByRole('link', { name: 'Hidden' }),
    ).toHaveAttribute('href', expect.stringContaining('status=hidden'));
  });

  it('says so when there are no reviews', () => {
    renderList([]);
    expect(screen.getByText('No reviews')).toBeInTheDocument();
  });
});
