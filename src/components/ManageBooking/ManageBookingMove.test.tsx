import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orderA } from '@/lib/bookingEmails.fixtures';
import type { CancelFacts } from '@/lib/cancelBooking';
import { managePageState, type ManageQuery } from '@/lib/manageBooking';
import { manageViewOf } from '@/lib/manageBooking.fixtures';
import type { MoveSubject, MoveTarget } from '@/lib/moveBooking';
import { ManageBooking, type ManageBookingProps } from './ManageBooking';

// Behaviours under test, one per decision, branch, or risk (the move step is a server-rendered form and needs no script):
// - a booking that can move offers a link, not a form, to the picker, and the picker is closed until the query opens it
// - the open picker is a form of radios, one per date with its spaces, the first checked, that posts the token and the date chosen
// - submitting calls the move action once with exactly those two fields; the cancel action is not called
// - with no date that has room, the picker says so and offers the booking back, and has no form
// - a booking outside the terms (window closed, started, cancelled) shows no move controls
// - the move's answer shows as the notice

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
const inWindow = new Date('2026-11-05T12:00:00Z');
const subject: MoveSubject = {
  facts,
  sessionId: 'a0000000-0000-4000-8000-0000000000aa',
  experienceId: 'e0000000-0000-4000-8000-0000000000ee',
  experienceStatus: 'live',
  fullRefundHoursBefore: 24,
};
const date = (
  id: string,
  startsAt: string,
  spacesLeft: number,
): MoveTarget => ({
  id,
  experienceId: subject.experienceId,
  status: 'scheduled',
  startsAt: new Date(startsAt),
  timeZone: 'America/New_York',
  spacesLeft,
});
const firstId = 'b0000000-0000-4000-8000-000000000001';
const secondId = 'b0000000-0000-4000-8000-000000000002';
const candidates = [
  date(firstId, '2026-11-14T21:00:00Z', 6),
  date(secondId, '2026-11-21T21:00:00Z', 3),
];

let cancelAction: ReturnType<
  typeof vi.fn<(formData: FormData) => Promise<void>>
>;
let moveAction: ReturnType<typeof vi.fn<(formData: FormData) => Promise<void>>>;

beforeEach(() => {
  cancelAction = vi.fn(() => Promise.resolve());
  moveAction = vi.fn(() => Promise.resolve());
});

function renderPage(
  view = manageViewOf(orderA, facts, inWindow, { subject, candidates }),
  query: ManageQuery = {},
) {
  const props: ManageBookingProps = {
    view,
    token,
    cancelAction,
    moveAction,
    ...managePageState(view, query),
  };
  return render(<ManageBooking {...props} />);
}

describe('the offer', () => {
  it('is a link to the picker, with no form and no radios, before the guest opens it', () => {
    renderPage(manageViewOf(orderA, facts, inWindow), {});

    expect(
      screen.getByRole('heading', { name: 'Need a different date?' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Move to another date' }),
    ).toHaveAttribute('href', `/manage/${token}?move=1`);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it.each([
    [
      'after the window closed',
      manageViewOf(orderA, facts, new Date('2026-11-06T22:00:00Z')),
    ],
    ['once the session started', manageViewOf(orderA, facts, orderA.startsAt)],
    [
      'for a cancelled booking',
      manageViewOf(
        { ...orderA, status: 'cancelled' },
        { ...facts, status: 'cancelled' },
        inWindow,
      ),
    ],
  ])('is not shown %s', (_name, view) => {
    renderPage(view, { move: '1' });

    expect(screen.queryByText('Need a different date?')).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Move to another date' }),
    ).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('the picker', () => {
  it('lists each date as a radio with its spaces, the first checked', () => {
    renderPage(undefined, { move: '1' });

    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
      firstId,
      secondId,
    ]);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
    expect(radios.every((radio) => radio.hasAttribute('required'))).toBe(true);
    expect(
      screen.getByRole('radio', {
        name: /Saturday, November 14, 2026 · 4:00 PM EST/,
      }),
    ).toBeVisible();
    expect(screen.getByText('6 spaces')).toBeVisible();
    expect(screen.getByText('3 left')).toBeVisible();
    expect(
      screen.getByRole('group', { name: 'Choose a new date' }),
    ).toBeVisible();
  });

  it('says the price stays and offers the booking back', () => {
    renderPage(undefined, { move: '1' });

    expect(
      screen.getByText(
        'The price stays the same: nothing more to pay and nothing refunded.',
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Keep my current date' }),
    ).toHaveAttribute('href', `/manage/${token}`);
    expect(
      screen.queryByRole('link', { name: 'Move to another date' }),
    ).toBeNull();
  });

  it('posts the token and the date chosen, once, and does not cancel', async () => {
    const { container } = renderPage(undefined, { move: '1' });

    fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement);
    const form = container.querySelector('form');
    if (!form) throw new Error('no form');
    expect(
      within(form).getByRole('button', { name: 'Move my booking' }),
    ).toHaveAttribute('type', 'submit');
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(moveAction).toHaveBeenCalledTimes(1);
    expect(cancelAction).not.toHaveBeenCalled();
    const data = moveAction.mock.calls[0]?.[0];
    expect([...(data?.entries() ?? [])]).toEqual([
      ['targetSessionId', secondId],
      ['manageToken', token],
    ]);
  });

  it('says no date has room and has no form when there is none', () => {
    const { container } = renderPage(
      manageViewOf(orderA, facts, inWindow, { subject, candidates: [] }),
      { move: '1' },
    );

    expect(
      screen.getByText(
        'No other dates have room for your group right now. Your booking stays as it is.',
      ),
    ).toBeVisible();
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Keep my current date' }),
    ).toHaveAttribute('href', `/manage/${token}`);
  });

  it('keeps the cancel link beside the move', () => {
    renderPage(undefined, { move: '1' });

    expect(
      screen.getByRole('link', { name: /Cancel and refund/ }),
    ).toHaveAttribute('href', `/manage/${token}?confirm=1`);
  });
});

describe('the answer', () => {
  it('shows a move as the success notice', () => {
    renderPage(manageViewOf(orderA, facts, inWindow), { moved: 'moved' });

    expect(screen.getByText('Your booking is moved')).toBeVisible();
  });

  it('shows a refusal as a warning with the picker closed', () => {
    renderPage(manageViewOf(orderA, facts, inWindow), { moved: 'sold_out' });

    expect(screen.getByText('That date is full')).toBeVisible();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
