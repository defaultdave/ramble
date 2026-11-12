import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BookingListRow } from './BookingListRow';

// Behaviours under test, one per decision, branch or risk:
// - a row is a list item with its title, each supporting line, and one link to the given address
// - a hint is part of the link's accessible name after its label, so rows with one label can be told apart
// - two supporting lines that read alike are both shown
// - with no hint the link's name is its label alone

const props = {
  title: 'Sunset kayak',
  details: ['Sat, Nov 14 · 2:00 PM EST', 'Confirmed · RMB-000001'],
  href: '/manage/token',
  linkLabel: 'Manage booking',
};

describe('BookingListRow', () => {
  it('shows the title and every supporting line in a list item', () => {
    render(
      <ul>
        <BookingListRow {...props} />
      </ul>,
    );
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Sunset kayak');
    expect(item).toHaveTextContent('Sat, Nov 14 · 2:00 PM EST');
    expect(item).toHaveTextContent('Confirmed · RMB-000001');
  });

  it('names the link by its label and hint', () => {
    render(
      <ul>
        <BookingListRow {...props} linkHint="RMB-000001" />
      </ul>,
    );
    expect(
      screen.getByRole('link', { name: 'Manage booking RMB-000001' }),
    ).toHaveAttribute('href', '/manage/token');
  });

  it('shows two supporting lines that read alike', () => {
    render(
      <ul>
        <BookingListRow {...props} details={['Same', 'Same']} />
      </ul>,
    );
    expect(screen.getAllByText('Same')).toHaveLength(2);
  });

  it('names the link by its label alone without a hint', () => {
    render(
      <ul>
        <BookingListRow {...props} />
      </ul>,
    );
    expect(
      screen.getByRole('link', { name: 'Manage booking' }),
    ).toBeInTheDocument();
  });
});
