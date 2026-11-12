import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  cancelledDetail,
  confirmedDetail,
  confirmedRow,
  failedRefundDetail,
  failedRefundRow,
} from './OpsBookings.fixtures';
import { OpsBookingDetailView } from './OpsBookingDetailView';
import { OpsBookingsList } from './OpsBookingsList';

// Behaviours under test:
// - the list shows each booking's reference as a link to its page, the guest, the session, the total, and the status in words
// - a booking whose refund failed is flagged in the list, and only it has a retry form carrying its id
// - the search box and the refund-failed filter are a GET form and a link, and the summary is announced
// - the detail offers exactly the actions its view allows, each a form carrying the booking id; the cancel form carries the refund ops was shown
// - an empty list and an empty refund list say so

const noop = () => undefined;
const actions = {
  cancel: noop,
  refund: noop,
  retryRefund: noop,
  resend: noop,
  voidLinks: noop,
};

function renderList(rows = [confirmedRow, failedRefundRow], summary = '') {
  return render(
    <OpsBookingsList
      rows={rows}
      query={{}}
      term=""
      summary={summary}
      cursor={null}
      nextCursor={null}
      retryRefund={noop}
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

  it('flags a booking whose refund failed, and offers retry on it alone', () => {
    renderList();
    expect(
      within(screen.getByRole('table')).getAllByText('Refund failed'),
    ).toHaveLength(1);
    expect(
      within(screen.getByRole('row', { name: /RMB-XYZ789/ })).getByText(
        'Refund failed',
      ),
    ).toBeInTheDocument();
    const retry = screen.getAllByRole('button', { name: 'Retry refund' });
    expect(retry).toHaveLength(1);
    expect(
      retry[0]?.closest('form')?.querySelector('input[name="orderId"]'),
    ).toHaveValue(failedRefundRow.id);
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
  const buttons = () =>
    screen.getAllByRole('button').map((button) => button.textContent);

  it('offers cancel with the shown refund, resend, and void for a confirmed booking', () => {
    const { container } = render(
      <OpsBookingDetailView detail={confirmedDetail} actions={actions} />,
    );
    expect(buttons()).toEqual([
      'Cancel booking',
      'Resend confirmation',
      'Void earlier links',
    ]);
    expect(
      container.querySelector('input[name="expectedRefundMinor"]'),
    ).toHaveValue('10800');
    expect(container.querySelector('input[name="resendId"]')).toHaveValue(
      '2f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    );
    for (const input of container.querySelectorAll('input[name="orderId"]')) {
      expect(input).toHaveValue(confirmedDetail.row.id);
    }
    expect(screen.getByText('No refunds yet.')).toBeInTheDocument();
  });

  it('offers retry for a failed refund, and the failed refund is listed', () => {
    render(
      <OpsBookingDetailView detail={failedRefundDetail} actions={actions} />,
    );
    expect(buttons()).toEqual(['Retry refund', 'Void earlier links']);
    expect(screen.getByText(/Guest cancelled/)).toBeInTheDocument();
  });

  it('offers a refund of the rest for a cancelled booking', () => {
    render(<OpsBookingDetailView detail={cancelledDetail} actions={actions} />);
    expect(buttons()).toEqual(['Refund $130.00', 'Void earlier links']);
  });

  it('shows the booking and its history in order', () => {
    render(<OpsBookingDetailView detail={confirmedDetail} actions={actions} />);
    expect(screen.getByText('pat@example.com')).toBeInTheDocument();
    const history = screen.getByRole('heading', { name: 'History' })
      .parentElement as HTMLElement;
    expect(
      within(history)
        .getAllByRole('listitem')
        .map((item) => item.firstChild?.textContent),
    ).toEqual(['Booking placed', 'Booking confirmed']);
  });
});
