import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  confirmedDetail,
  confirmedRow,
  failedRefundDetail,
  failedRefundRow,
} from './OpsBookings.fixtures';
import { OpsBookingDetailView } from './OpsBookingDetailView';
import { OpsBookingsList } from './OpsBookingsList';

// Behaviours under test:
// - the list shows each booking's reference as a link to its page, the guest, the session, the total, and the status in words
// - a booking whose refund failed is flagged in the list
// - the search box and the refund-failed filter are a GET form and a link, and the summary is announced
// - the detail shows the booking, its refunds, and its history, and offers no action
// - an empty list and an empty refund list say so

function renderList(rows = [confirmedRow, failedRefundRow], summary = '') {
  return render(
    <OpsBookingsList
      rows={rows}
      query={{}}
      term=""
      summary={summary}
      cursor={null}
      nextCursor={null}
    />,
  );
}

describe('OpsBookingsList', () => {
  it('links each reference to its booking and shows guest, session, total, and status', () => {
    renderList();
    const row = screen.getByRole('row', { name: /RMB-ABC234/ });
    expect(
      within(row).getByRole('link', { name: 'RMB-ABC234' }),
    ).toHaveAttribute('href', confirmedRow.href);
    expect(within(row).getByText('pat@example.com')).toBeInTheDocument();
    expect(
      within(row).getByText('Sat, Nov 14 · 2:00 PM EST'),
    ).toBeInTheDocument();
    expect(within(row).getByText('$108.00')).toBeInTheDocument();
    expect(within(row).getByText('Confirmed')).toBeInTheDocument();
  });

  it('flags a booking whose refund failed, and no other', () => {
    renderList();
    expect(
      within(screen.getByRole('table')).getAllByText('Refund failed'),
    ).toHaveLength(1);
    expect(
      within(screen.getByRole('row', { name: /RMB-XYZ789/ })).getByText(
        'Refund failed',
      ),
    ).toBeInTheDocument();
  });

  it('searches with a GET form and filters with a link, and announces the summary', () => {
    renderList([confirmedRow], '1 booking for RMB-ABC234.');
    const search = screen.getByRole('search', { name: 'Search bookings' });
    expect(search).toHaveAttribute('method', 'get');
    expect(
      within(
        screen.getByRole('navigation', { name: 'Filter bookings' }),
      ).getByRole('link', { name: 'Refund failed' }),
    ).toHaveAttribute('href', expect.stringContaining('status=refund_failed'));
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 booking for RMB-ABC234.',
    );
  });

  it('says so when nothing was found', () => {
    renderList([]);
    expect(screen.getByText('No bookings')).toBeInTheDocument();
  });
});

describe('OpsBookingDetailView', () => {
  it('shows the booking, what was refunded, and the history in order', () => {
    render(<OpsBookingDetailView detail={confirmedDetail} />);
    expect(screen.getByText('pat@example.com')).toBeInTheDocument();
    expect(screen.getByText('$108.00')).toBeInTheDocument();
    expect(screen.getByText('No refunds yet.')).toBeInTheDocument();
    const history = screen.getByRole('heading', { name: 'History' })
      .parentElement as HTMLElement;
    expect(
      within(history)
        .getAllByRole('listitem')
        .map((item) => item.firstChild?.textContent),
    ).toEqual(['Booking placed', 'Booking confirmed']);
  });

  it('lists each refund with its reason and status', () => {
    render(<OpsBookingDetailView detail={failedRefundDetail} />);
    expect(screen.getByText(/Guest cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/\$108.00 · Failed/)).toBeInTheDocument();
  });

  it('offers no action: reading a booking changes nothing', () => {
    render(<OpsBookingDetailView detail={failedRefundDetail} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
