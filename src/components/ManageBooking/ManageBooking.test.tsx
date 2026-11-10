import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orderA, orderB } from '@/lib/bookingEmails.fixtures';
import type { CancelBookingResult, CancelFacts } from '@/lib/cancelBooking';
import { manageView } from '@/lib/manageBooking';
import { ManageBooking, ManageTooManyTries } from './ManageBooking';

// Behaviours under test, one per decision, branch, or risk.
// - the refund is shown before anything is asked: the booking, the sentence about the refund, and a button naming the amount
// - nothing is sent on the first press: it asks again with the amount, and "Keep my booking" goes back without sending
// - confirming sends the token and the refund that was shown, once, and a second press while it is working sends nothing
// - a cancelled answer shows its notice, takes the cancel controls away, and moves focus to the notice
// - a changed refund shows its notice, asks the page to render again for the new amount, and keeps the controls
// - a refusal that can be retried keeps the controls; a refusal that cannot be (a dead link, already cancelled) removes them
// - a booking that is cancelled, or has started, shows no cancel controls
// - the too-many-tries page says how long to wait and shows no booking

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

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

const active = manageView(orderA, facts, before);
const cancelled = manageView(
  { ...orderA, status: 'cancelled' },
  { ...facts, status: 'cancelled' },
  before,
);
const closed = manageView(orderA, facts, orderA.startsAt);

let cancel: ReturnType<
  typeof vi.fn<(input: unknown) => Promise<CancelBookingResult>>
>;

beforeEach(() => {
  refresh.mockReset();
  cancel = vi.fn(() =>
    Promise.resolve<CancelBookingResult>({
      status: 'cancelled',
      refundMinor: 23_412,
      giftReinstated: false,
      refundEta: 'Your bank usually shows it within 5 to 10 business days.',
    }),
  );
});

const renderManage = (view = active) =>
  render(<ManageBooking view={view} token={token} cancel={cancel} />);

const press = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
};

describe('the refund shown first', () => {
  it('shows the booking, the refund sentence, and a button that names the amount', () => {
    renderManage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Your booking' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Sunset sail on the Hudson' }),
    ).toBeVisible();
    expect(screen.getByText(/Saturday, November 7, 2026/)).toBeVisible();
    expect(screen.getByText(/full refund of \$234\.12/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Cancel and refund $234.12' }),
    ).toBeVisible();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('shows a button that says no refund after the window', () => {
    renderManage(manageView(orderA, facts, new Date('2026-11-06T22:00:00Z')));

    expect(
      screen.getByRole('button', { name: 'Cancel without a refund' }),
    ).toBeVisible();
    expect(screen.queryByText(/goes back to your card/)).toBeNull();
  });

  it('shows a gift split for a booking paid with a gift', () => {
    renderManage(
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
  });
});

describe('asking twice before it cancels', () => {
  it('asks again with the amount on the first press and sends nothing', async () => {
    renderManage();

    await press('Cancel and refund $234.12');

    const group = screen.getByRole('group', { name: 'Cancel this booking?' });
    expect(
      within(group).getByText(/\$234\.12 goes back to your card/),
    ).toBeVisible();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('goes back without sending when the guest keeps the booking', async () => {
    renderManage();
    await press('Cancel and refund $234.12');

    await press('Keep my booking');

    expect(screen.queryByRole('group')).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('sends the token and the refund that was shown, once', async () => {
    renderManage();
    await press('Cancel and refund $234.12');

    await press('Cancel and refund $234.12');

    expect(cancel).toHaveBeenCalledExactlyOnceWith({
      manageToken: token,
      expectedRefundMinor: 23_412,
    });
  });

  it('sends nothing more while the cancel is working', async () => {
    let finish: (result: CancelBookingResult) => void = () => undefined;
    cancel.mockReturnValue(
      new Promise<CancelBookingResult>((resolve) => {
        finish = resolve;
      }),
    );
    renderManage();
    await press('Cancel and refund $234.12');

    await press('Cancel and refund $234.12');
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel and refund $234.12' }),
    );

    expect(cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ status: 'already_cancelled' });
      await Promise.resolve();
    });
  });
});

describe('what the page says after', () => {
  const confirmCancel = async () => {
    renderManage();
    await press('Cancel and refund $234.12');
    await press('Cancel and refund $234.12');
  };

  it('shows the refund, takes the controls away, and moves focus to the notice', async () => {
    await confirmCancel();

    const notice = screen.getByRole('status');
    expect(within(notice).getByText('Your booking is cancelled')).toBeVisible();
    expect(
      within(notice).getByText(/Your refund of \$234\.12 goes back/),
    ).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(notice.parentElement).toHaveFocus();
  });

  it('shows the new refund, asks the page to render again, and keeps the controls, when the terms changed', async () => {
    cancel.mockResolvedValue({ status: 'terms_changed', refundMinor: 0 });
    await confirmCancel();

    expect(screen.getByText('The refund has changed')).toBeVisible();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Cancel and refund $234.12' }),
    ).toBeVisible();
  });

  it.each([
    [
      'refund_unavailable',
      { status: 'refund_unavailable', reason: 'no_payment' },
    ],
    ['rate_limited', { status: 'rate_limited', retryAfterSeconds: 30 }],
  ] as const)(
    'keeps the controls for a retryable answer (%s)',
    async (_name, result) => {
      cancel.mockResolvedValue(result);
      await confirmCancel();

      expect(refresh).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', { name: 'Cancel and refund $234.12' }),
      ).toBeVisible();
    },
  );

  it.each([
    [{ status: 'already_cancelled' }, 'This booking is already cancelled'],
    [{ status: 'not_found' }, 'This link no longer works'],
    [
      { status: 'not_refundable', freeCancelUntil: null },
      "This booking can't be cancelled here",
    ],
  ] as const)(
    'removes the controls for an answer that cannot be retried (%o)',
    async (result, title) => {
      cancel.mockResolvedValue(result);
      await confirmCancel();

      expect(screen.getByText(title)).toBeVisible();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );
});

describe('a booking that cannot be cancelled', () => {
  it('shows a cancelled booking with nothing to press', () => {
    renderManage(cancelled);

    expect(screen.getByText('This booking is cancelled')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Explore more experiences' }),
    ).toHaveAttribute('href', '/new-york/browse');
  });

  it('shows a booking that has started with nothing to press', () => {
    renderManage(closed);

    expect(
      screen.getByText("This booking can't be cancelled here"),
    ).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('always offers the help center and contact page', () => {
    renderManage(closed);

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
