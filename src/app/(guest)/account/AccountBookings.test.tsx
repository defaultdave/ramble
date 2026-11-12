import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AccountBookingView } from '@/lib/accountBookings';
import { AccountBookings } from './AccountBookings';

// Behaviours under test, one per decision, branch or risk:
// - one h1, then an Upcoming and a Past group, each a labelled section holding a list
// - each booking shows the experience, time, status and reference, and a link to its manage page that a screen reader can tell from the others
// - a group with no bookings is left out
// - no bookings at all says so and offers the browse page

const booking = (
  n: number,
  overrides: Partial<AccountBookingView> = {},
): AccountBookingView => ({
  id: String(n),
  reference: `RMB-00000${String(n)}`,
  experienceName: 'Sunset kayak',
  whenLabel: 'Sat, Nov 14 · 2:00 PM EST',
  statusLabel: 'Confirmed',
  manageHref: `/manage/token${String(n)}`,
  ...overrides,
});

describe('AccountBookings', () => {
  it('lists upcoming and past bookings under their own headings', () => {
    render(
      <AccountBookings
        title="My bookings"
        view={{
          upcoming: [booking(1)],
          past: [booking(2, { statusLabel: 'Cancelled' })],
          empty: false,
        }}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'My bookings' }),
    ).toBeInTheDocument();
    const upcoming = screen.getByRole('region', { name: 'Upcoming' });
    expect(within(upcoming).getAllByRole('listitem')).toHaveLength(1);
    expect(upcoming).toHaveTextContent('Sunset kayak');
    expect(upcoming).toHaveTextContent('Confirmed · RMB-000001');
    const past = screen.getByRole('region', { name: 'Past' });
    expect(past).toHaveTextContent('Cancelled · RMB-000002');
  });

  it('links each booking to its manage page, named by its reference', () => {
    render(
      <AccountBookings
        title="My bookings"
        view={{ upcoming: [booking(1), booking(2)], past: [], empty: false }}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Manage booking RMB-000001' }),
    ).toHaveAttribute('href', '/manage/token1');
    expect(
      screen.getByRole('link', { name: 'Manage booking RMB-000002' }),
    ).toHaveAttribute('href', '/manage/token2');
  });

  it('leaves out a group with nothing in it', () => {
    render(
      <AccountBookings
        title="My bookings"
        view={{ upcoming: [], past: [booking(1)], empty: false }}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Upcoming' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Past' })).toBeInTheDocument();
  });

  it('says there are no bookings and offers to browse', () => {
    render(
      <AccountBookings
        title="My bookings"
        view={{ upcoming: [], past: [], empty: true }}
      />,
    );
    expect(screen.getByText(/no bookings yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Find something to do' }),
    ).toHaveAttribute('href', '/new-york/browse');
    expect(screen.queryByRole('list')).toBeNull();
  });
});
