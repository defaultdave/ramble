import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orderA, orderB } from '@/lib/bookingEmails.fixtures';
import type { CancelFacts } from '@/lib/cancelBooking';
import {
  managePageState,
  manageView,
  type ManageQuery,
} from '@/lib/manageBooking';
import {
  ManageBooking,
  ManageTooManyTries,
  type ManageBookingProps,
} from './ManageBooking';

// Behaviours under test, one per decision, branch, or risk (the page is a server component and needs no script):
// - the first step shows the booking, the refund sentence, a link (not a form) to the second step, and the footnote
// - the second step is a form that says the refund again and posts the token and the refund that was shown, and offers to keep the booking
// - submitting the form calls the action with exactly those two fields, once
// - the page shows the notice it is given, with its tone, and none when it has none
// - a booking after its window, or paid with a gift, offers a cancel with no refund and no footnote
// - a cancelled booking and one that has started show no cancel controls; a cancelled one offers other experiences
// - the help center and contact links are always there
// - the too-many-tries page says how long to wait and shows no booking

const token = 'A'.repeat(43);
const facts: CancelFacts = {
  status: 'confirmed',
  kind: 'booking',
  ticketSubtotalMinor: 21_500,
  taxMinor: 1_912,
  totalMinor: 23_412,
  amountDueMinor: 23_412,
  commissionMinor: 3_225,
  commissionRateBps: 1_500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
  giftAppliedMinor: 0,
  freeCancelUntil: orderA.freeCancelUntil,
  manageTokenVersion: 1,
  sessionStartsAt: orderA.startsAt,
  seats: 3,
};
const before = new Date('2026-11-05T12:00:00Z');

let cancelAction: ReturnType<
  typeof vi.fn<(formData: FormData) => Promise<void>>
>;

beforeEach(() => {
  cancelAction = vi.fn(() => Promise.resolve());
});

function renderPage(
  view = manageView(orderA, facts, before),
  query: ManageQuery = {},
) {
  const props: ManageBookingProps = {
    view,
    token,
    cancelAction,
    ...managePageState(view, query),
  };
  return render(<ManageBooking {...props} />);
}

describe('the first step', () => {
  it('shows the booking, the refund sentence, and the footnote', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Your booking' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Sunset sail on the Hudson' }),
    ).toBeVisible();
    expect(screen.getByText(/Saturday, November 7, 2026/)).toBeVisible();
    expect(screen.getByText('Total charged')).toBeVisible();
    expect(screen.getByText(/full refund of \$234\.12/)).toBeVisible();
    expect(
      screen.getByText(
        'Your bank usually shows it within 5 to 10 business days.',
      ),
    ).toBeVisible();
  });

  it('links to the second step instead of cancelling', () => {
    renderPage();

    const link = screen.getByRole('link', {
      name: 'Cancel and refund $234.12',
    });
    expect(link).toHaveAttribute('href', `/manage/${token}?confirm=1`);
    expect(screen.queryByRole('button')).toBeNull();
    expect(cancelAction).not.toHaveBeenCalled();
  });

  it('shows a gift split for a booking paid with a gift', () => {
    renderPage(
      manageView(
        orderB,
        {
          ...facts,
          amountDueMinor: 5_500,
          giftAppliedMinor: 4_000,
          sessionStartsAt: orderB.startsAt,
          freeCancelUntil: orderB.freeCancelUntil,
        },
        before,
      ),
    );

    expect(screen.getByText('Paid with your gift')).toBeVisible();
    expect(screen.getByText('Charged to your card')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Cancel without a refund' }),
    ).toBeVisible();
    expect(screen.queryByText(/5 to 10 business days/)).toBeNull();
  });

  it('offers a cancel with no refund after the window', () => {
    renderPage(manageView(orderA, facts, new Date('2026-11-06T22:00:00Z')));

    expect(
      screen.getByRole('link', { name: 'Cancel without a refund' }),
    ).toBeVisible();
    expect(screen.queryByText(/5 to 10 business days/)).toBeNull();
  });
});

describe('the second step', () => {
  it('says the refund again, and posts the token and the refund that was shown', () => {
    const { container } = renderPage(undefined, { confirm: '1' });

    const form = screen.getByRole('form', { name: 'Cancel this booking?' });
    expect(
      within(form).getByText(/\$234\.12 goes back to your card/),
    ).toBeVisible();
    expect(container.querySelector('input[name="manageToken"]')).toHaveValue(
      token,
    );
    expect(
      container.querySelector('input[name="expectedRefundMinor"]'),
    ).toHaveValue('23412');
    expect(
      within(form).getByRole('button', { name: 'Cancel and refund $234.12' }),
    ).toHaveAttribute('type', 'submit');
    expect(
      within(form).getByRole('link', { name: 'Keep my booking' }),
    ).toHaveAttribute('href', `/manage/${token}`);
  });

  it('calls the action once with exactly the two fields when submitted', async () => {
    renderPage(undefined, { confirm: '1' });

    await act(async () => {
      fireEvent.submit(
        screen.getByRole('form', { name: 'Cancel this booking?' }),
      );
      await Promise.resolve();
    });

    expect(cancelAction).toHaveBeenCalledTimes(1);
    const data = cancelAction.mock.calls[0]?.[0];
    expect([...(data?.entries() ?? [])]).toEqual([
      ['manageToken', token],
      ['expectedRefundMinor', '23412'],
    ]);
  });

  it('posts a refund of 0 for a cancel with no refund', () => {
    const { container } = renderPage(
      manageView(orderA, facts, new Date('2026-11-06T22:00:00Z')),
      { confirm: '1' },
    );

    expect(
      container.querySelector('input[name="expectedRefundMinor"]'),
    ).toHaveValue('0');
    expect(screen.getByText(/nothing will be refunded/)).toBeVisible();
  });
});

describe('the notice', () => {
  it.each([
    ['cancelled', 'status'],
    ['refund_unavailable', 'alert'],
  ] as const)('shows the answer %s with its role', (code, role) => {
    const cancelled = manageView(
      { ...orderA, status: 'cancelled' },
      {
        ...facts,
        status: 'cancelled',
        refundedTicketMinor: 21_500,
        refundedTaxMinor: 1_912,
        commissionReturnedMinor: 3_225,
      },
      before,
    );
    renderPage(code === 'cancelled' ? cancelled : undefined, { result: code });

    expect(screen.getByRole(role)).toBeVisible();
  });

  it('shows the refund a cancelled booking gave back', () => {
    renderPage(
      manageView(
        { ...orderA, status: 'cancelled' },
        {
          ...facts,
          status: 'cancelled',
          refundedTicketMinor: 21_500,
          refundedTaxMinor: 1_912,
          commissionReturnedMinor: 3_225,
        },
        before,
      ),
      { result: 'cancelled' },
    );

    expect(
      screen.getByText(/Your refund of \$234\.12 goes back/),
    ).toBeVisible();
  });

  it('shows none for an active booking with no answer', () => {
    renderPage();

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a booking that cannot be cancelled', () => {
  it('shows a cancelled booking with nothing to press and other experiences to explore', () => {
    renderPage(
      manageView(
        { ...orderA, status: 'cancelled' },
        { ...facts, status: 'cancelled' },
        before,
      ),
    );

    expect(screen.getByText('This booking is already cancelled')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: /Cancel/ })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Explore more experiences' }),
    ).toHaveAttribute('href', '/new-york/browse');
  });

  it('shows a booking that has started with nothing to press', () => {
    renderPage(manageView(orderA, facts, orderA.startsAt));

    expect(
      screen.getByText("This booking can't be cancelled here"),
    ).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: /Cancel/ })).toBeNull();
  });

  it('always offers the help center and contact page', () => {
    renderPage(manageView(orderA, facts, orderA.startsAt));

    expect(screen.getByRole('link', { name: 'help center' })).toHaveAttribute(
      'href',
      '/help',
    );
    expect(screen.getByRole('link', { name: 'contact us' })).toHaveAttribute(
      'href',
      '/contact',
    );
  });
});

describe('the too-many-tries page', () => {
  it('says how long to wait and shows no booking', () => {
    render(<ManageTooManyTries retryAfterSeconds={61} />);

    expect(screen.getByText('Too many tries')).toBeVisible();
    expect(screen.getByText('Try again in 2 minutes.')).toBeVisible();
    expect(screen.queryByText('Sunset sail on the Hudson')).toBeNull();
  });
});
