import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  appUrl,
  fakeManageToken,
  orderA,
  orderB,
} from '@/lib/bookingEmails.fixtures';
import { orderPageView } from '@/lib/orderReceipt';
import { OrderConfirmation } from './OrderConfirmation';

// Behaviours under test, one per decision, branch, or risk.
// - a confirmed order shows the greeting, the booking, the receipt lines, and the seller wording
// - it offers Google Calendar, a .ics download, Open in Maps, and Manage booking, each to the right address
// - without a meeting point it offers no maps link; with a gift it shows both amounts
// - a pending order shows the checking state and none of the confirmed actions
// - a failed, refunded, or closed order shows its notice and none of the confirmed actions

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const token = 'A'.repeat(43);
const checkStatus = vi.fn(() => Promise.resolve({ state: 'pending' as const }));

function renderOrder(source: Parameters<typeof orderPageView>[0]) {
  return render(
    <OrderConfirmation
      view={orderPageView(source, { manageToken: fakeManageToken, appUrl })}
      token={token}
      checkStatus={checkStatus}
    />,
  );
}

const confirmedActions = [
  'Add to Google Calendar',
  'Download .ics file',
  'Open in Maps',
  'Manage booking',
];

describe('OrderConfirmation, confirmed', () => {
  it('greets, names the booking, and itemizes the receipt', () => {
    renderOrder(orderA);
    expect(
      screen.getByRole('heading', { level: 1, name: "You're booked, Pat" }),
    ).toBeVisible();
    expect(screen.getByText('Confirmation RMB-A3K7MN')).toBeVisible();
    const booking = screen.getByRole('region', {
      name: 'Sunset sail on the Hudson',
    });
    expect(booking).toHaveTextContent('Saturday, November 7, 2026');
    expect(booking).toHaveTextContent('3 guests');
    expect(booking).toHaveTextContent(
      'Meet at Pier 40, West Side Highway at Houston Street',
    );
    const receipt = screen.getByRole('region', { name: 'Receipt' });
    expect(within(receipt).getByText('$234.12')).toBeVisible();
    expect(receipt).toHaveTextContent(
      "Harbor Light Sailing is the seller of this experience. Ramble collected your payment as Harbor Light Sailing's agent.",
    );
  });

  it('offers the calendar, the file, the map, and the manage page', () => {
    renderOrder(orderA);
    expect(
      screen.getByRole('link', { name: /Add to Google Calendar/ }),
    ).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/calendar\.google\.com\//),
    );
    const file = screen.getByRole('link', { name: 'Download .ics file' });
    expect(file).toHaveAttribute('download', 'ramble-booking.ics');
    expect(file.getAttribute('href')).toMatch(/^data:text\/calendar/);
    expect(screen.getByRole('link', { name: /Open in Maps/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/www\.google\.com\/maps\/search\//),
    );
    expect(
      screen.getByRole('link', { name: 'Manage booking' }),
    ).toHaveAttribute('href', `/manage/${fakeManageToken}`);
  });

  it('leaves out the map without a meeting point, and shows what a gift covered', () => {
    renderOrder(orderB);
    expect(screen.queryByRole('link', { name: /Open in Maps/ })).toBeNull();
    expect(screen.getByText('Paid with your gift')).toBeVisible();
    expect(screen.getByText('Charged to your card')).toBeVisible();
  });
});

describe('OrderConfirmation, not confirmed', () => {
  it('shows the checking state for a pending payment, with no booking actions', () => {
    renderOrder({ ...orderA, status: 'pending_payment' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking your payment',
    );
    for (const name of confirmedActions) {
      expect(screen.queryByRole('link', { name: new RegExp(name) })).toBeNull();
    }
  });

  it.each([
    ['payment_failed', "Your payment didn't go through"],
    [
      'refunded_after_lapse',
      "We couldn't keep your spaces, so we refunded you",
    ],
    ['cancelled', 'This booking is no longer active'],
  ] as const)(
    'shows the notice for %s, with no booking actions',
    (status, title) => {
      renderOrder({ ...orderA, status, confirmedAt: null });
      expect(screen.getByText(title)).toBeVisible();
      for (const name of confirmedActions) {
        expect(
          screen.queryByRole('link', { name: new RegExp(name) }),
        ).toBeNull();
      }
    },
  );
});
