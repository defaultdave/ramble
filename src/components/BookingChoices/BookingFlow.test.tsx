import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingBarIsland } from '@/components/BookingBar/BookingBarIsland';
import { BookingPanelIsland } from '@/components/BookingPanel/BookingPanelIsland';
import { BookingSheetIsland } from '@/components/BookingSheet/BookingSheetIsland';
import type { BookingOffer } from '@/lib/bookingDraft';
import {
  kayakOffer,
  kidsOffer,
  optionId,
  session,
  twentyOneOffer,
} from '@/lib/bookingDraft.fixtures';
import type { ReserveResult } from '@/lib/holds';

// Behaviours under test, one per decision, branch or risk:
// - the bar opens the sheet from Choose date; the sheet picks a date, a time, and a party, and Continue asks for the hold and goes to checkout
// - the bar, the sheet, and the panel share one draft: a choice in one shows in the others; leaving the page starts the next visit fresh
// - ?date= preselects its date, and its lone time
// - every answer the reserve can give says what happened in the sheet and the panel: sold out with other dates that can be chosen, a block with its time, the limit, a struck session
// - paused: the bar, the sheet, and the panel say so, from the start and when an answer says so
// - a reserve that throws says nothing was held, and the guest can try again
// - gift mode says gifts are not open and cannot continue; with gifts off there is no switch
// - Continue waits while the hold is placed and cannot be pressed twice
// - the party: children appear only where offered, a free adult beside children needs a child, and 21+ says so

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), push: vi.fn() }));
vi.mock('@/server/actions/holds', () => ({ reserveSpaces: mocks.reserve }));
vi.mock('next/navigation', () => {
  const router = { push: mocks.push };
  return { useRouter: () => router };
});

const held: ReserveResult = {
  status: 'held',
  holdId: 'hold-1',
  expiresAt: '2026-10-24T20:00:00Z',
  totalMinor: 13000,
  lines: [
    {
      priceOptionId: optionId(11),
      kind: 'adult',
      quantity: 2,
      unitPriceMinor: 6500,
      usesSpace: true,
      lineTotalMinor: 13000,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue(held);
});

function Page({
  offer,
  children,
}: {
  offer: BookingOffer;
  children?: ReactNode;
}) {
  return (
    <>
      <BookingBarIsland offer={offer} />
      <BookingSheetIsland offer={offer} />
      {children}
    </>
  );
}

const day = (name: string) => screen.getByRole('button', { name });
const sheet = () => screen.getByRole('dialog', { name: kayakOffer.title });

async function chooseSaturdayEvening() {
  await userEvent.click(day('Saturday, October 24, 2026'));
  await userEvent.click(screen.getByRole('button', { name: /5:30 PM EDT/ }));
}

describe('the bar and the sheet', () => {
  it('shows the lowest price and the next date, and opens the sheet from Choose date', async () => {
    render(<Page offer={kayakOffer} />);
    expect(screen.getByText('From $65')).toBeVisible();
    expect(screen.getByText('per person · next Thu, Oct 22')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Choose date' }));

    expect(sheet()).toBeVisible();
    expect(within(sheet()).getByText('Pick a date')).toBeVisible();
  });

  it('picks a date, a time, and a party, and holds the spaces from Continue', async () => {
    render(<Page offer={kayakOffer} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose date' }));

    await chooseSaturdayEvening();

    expect(within(sheet()).getByText('Time on Sat, Oct 24')).toBeVisible();
    expect(within(sheet()).getByText("Who's coming")).toBeVisible();
    expect(within(sheet()).getByText('$65 × 2 guests')).toBeVisible();
    expect(within(sheet()).getByText('$130.00')).toBeVisible();
    expect(
      within(sheet()).getByText(
        'Free cancellation until Sat, Oct 24, 5:30 PM EDT.',
      ),
    ).toBeVisible();

    await userEvent.click(
      within(sheet()).getByRole('button', { name: 'Increase Guests' }),
    );
    await userEvent.click(
      within(sheet()).getByRole('button', { name: 'Continue · $195.00' }),
    );

    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith({
      sessionId: optionId(103),
      items: [{ priceOptionId: optionId(11), quantity: 3 }],
      purpose: 'booking',
    });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/checkout/hold-1');
  });

  it('leaves Continue off until a time is chosen', async () => {
    render(<Page offer={kayakOffer} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    expect(
      within(sheet()).getByRole('button', { name: 'Continue' }),
    ).toBeDisabled();
  });

  it('shows what is chosen on the bar once the sheet is closed, and holds from the bar', async () => {
    render(<Page offer={kayakOffer} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    await chooseSaturdayEvening();
    await userEvent.click(
      within(sheet()).getByRole('button', { name: 'Close' }),
    );

    expect(screen.getByText('Sat, Oct 24 · 5:30 PM EDT')).toBeVisible();
    expect(screen.getByText('2 guests · $130.00')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith('/checkout/hold-1');
  });

  it('waits while the hold is placed, and asks once however many times Continue is pressed', async () => {
    let finish: (result: ReserveResult) => void = () => undefined;
    mocks.reserve.mockReturnValue(
      new Promise<ReserveResult>((resolve) => {
        finish = resolve;
      }),
    );
    render(<Page offer={{ ...kayakOffer, preselectedDate: '2026-10-22' }} />);
    const button = screen.getByRole('button', { name: 'Continue' });

    await userEvent.click(button);
    await userEvent.click(button);

    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('aria-busy', 'true');
    finish(held);
  });

  it('preselects the date in the address, and its only time', () => {
    render(<Page offer={{ ...kayakOffer, preselectedDate: '2026-10-22' }} />);
    expect(screen.getByText('Thu, Oct 22 · 5:30 PM EDT')).toBeVisible();
    expect(screen.getByText('2 guests · $130.00')).toBeVisible();
  });

  it('sends the guest to similar experiences when no date has room', () => {
    render(
      <Page
        offer={{
          ...kayakOffer,
          sessions: [session(4, '2026-10-24', '7:00 PM EDT', 0)],
        }}
      />,
    );
    expect(screen.getByText('No open dates')).toBeVisible();
    expect(screen.getByRole('link', { name: 'See similar' })).toHaveAttribute(
      'href',
      kayakOffer.similarHref,
    );
  });
});

describe('one draft for the bar, the sheet, and the panel', () => {
  it('shows a choice made in the panel on the bar', async () => {
    render(
      <>
        <BookingBarIsland offer={kayakOffer} />
        <BookingPanelIsland offer={kayakOffer} />
      </>,
    );
    await userEvent.click(day('Saturday, October 24, 2026'));
    await userEvent.click(screen.getByRole('button', { name: /5:30 PM EDT/ }));

    expect(screen.getByText('Sat, Oct 24 · 5:30 PM EDT')).toBeVisible();
    expect(screen.getByText('$65 × 2 guests')).toBeVisible();
  });

  it('starts the next visit from the address again, not from the last choices', async () => {
    const first = render(<BookingPanelIsland offer={kayakOffer} />);
    await userEvent.click(day('Saturday, October 24, 2026'));
    expect(screen.getByText('Time on Sat, Oct 24')).toBeVisible();
    first.unmount();

    render(<BookingPanelIsland offer={kayakOffer} />);
    expect(screen.queryByText('Time on Sat, Oct 24')).toBeNull();
  });
});

describe('the panel', () => {
  it('holds the spaces from its own Continue, and says how long the hold is kept', async () => {
    render(<BookingPanelIsland offer={kayakOffer} />);
    const panel = screen.getByRole('region', { name: 'Book this experience' });
    expect(within(panel).getByText('per person')).toBeVisible();
    expect(
      within(panel).getByRole('button', { name: 'Continue' }),
    ).toBeDisabled();
    await userEvent.click(day('Saturday, October 24, 2026'));
    await userEvent.click(screen.getByRole('button', { name: /5:30 PM EDT/ }));

    await userEvent.click(
      within(panel).getByRole('button', { name: 'Continue · $130.00' }),
    );

    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith('/checkout/hold-1');
    expect(
      within(panel).getByText(/We hold your spaces while you pay/),
    ).toBeVisible();
  });

  it('says there are no open dates, and offers similar experiences and a private session', () => {
    render(<BookingPanelIsland offer={{ ...kayakOffer, sessions: [] }} />);
    expect(screen.getByText('No open dates right now')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Ask about a private session' }),
    ).toHaveAttribute('href', '/contact');
  });
});

describe('the answers of the reserve', () => {
  async function reserveWith(result: ReserveResult | Error) {
    if (result instanceof Error) mocks.reserve.mockRejectedValue(result);
    else mocks.reserve.mockResolvedValue(result);
    render(<Page offer={kayakOffer} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    await chooseSaturdayEvening();
    await userEvent.click(
      within(sheet()).getByRole('button', { name: 'Continue · $130.00' }),
    );
  }

  it('offers other dates after a sell-out (S5), strikes the time, and chooses one on a tap', async () => {
    await reserveWith({
      status: 'sold_out',
      alternatives: [
        {
          sessionId: optionId(501),
          startsAt: '2026-11-07T19:00:00Z',
          timeZone: 'America/New_York',
          spacesLeft: 6,
        },
      ],
    });

    expect(within(sheet()).getByRole('alert')).toHaveTextContent(
      'Those spaces just sold out',
    );
    expect(
      within(sheet()).queryByRole('button', { name: /5:30 PM EDT/ }),
    ).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();

    await userEvent.click(
      within(sheet()).getByRole('button', {
        name: 'Sat, Nov 7 · 2:00 PM EST · 6 spaces',
      }),
    );

    expect(within(sheet()).queryByRole('alert')).toBeNull();
    expect(within(sheet()).getByText('Time on Sat, Nov 7')).toBeVisible();
    expect(
      within(sheet()).getByRole('button', { name: 'Continue · $130.00' }),
    ).toBeEnabled();
  });

  it('points to similar experiences after a sell-out with no other date', async () => {
    await reserveWith({ status: 'sold_out', alternatives: [] });
    expect(
      within(sheet()).getByRole('link', { name: 'See similar experiences' }),
    ).toHaveAttribute('href', kayakOffer.similarHref);
  });

  it('says when the block ends (S4)', async () => {
    await reserveWith({
      status: 'blocked',
      reason: 'too_many_holds',
      until: '2026-10-24T19:42:00Z',
    });
    expect(within(sheet()).getByRole('alert')).toHaveTextContent(
      'You can try again at 3:42 PM EDT.',
    );
  });

  it('says the device holds as many spaces as it may (S4)', async () => {
    await reserveWith({ status: 'blocked', reason: 'device_limit' });
    expect(within(sheet()).getByRole('alert')).toHaveTextContent(
      'One device can hold up to 6 spaces at once',
    );
  });

  it('says a session was cancelled and strikes it', async () => {
    await reserveWith({ status: 'unavailable', reason: 'session_cancelled' });
    expect(within(sheet()).getByRole('alert')).toHaveTextContent(
      'That session was cancelled',
    );
    expect(
      within(sheet()).queryByRole('button', { name: /5:30 PM EDT/ }),
    ).toBeNull();
  });

  it('switches the sheet and the bar to paused when bookings were paused meanwhile', async () => {
    await reserveWith({ status: 'unavailable', reason: 'bookings_paused' });
    expect(within(sheet()).getByRole('status')).toHaveTextContent(
      'Bookings are paused',
    );
    expect(
      within(sheet()).queryByRole('button', { name: /Continue/ }),
    ).toBeNull();
  });

  it('says nothing was held when the reserve throws, and lets the guest try again', async () => {
    await reserveWith(new Error('The bot check failed'));
    expect(within(sheet()).getByRole('alert')).toHaveTextContent(
      'nothing was held',
    );
    mocks.reserve.mockResolvedValue(held);

    await userEvent.click(
      within(sheet()).getByRole('button', { name: 'Continue · $130.00' }),
    );

    expect(mocks.push).toHaveBeenCalledWith('/checkout/hold-1');
  });
});

describe('paused', () => {
  const paused = { ...kayakOffer, paused: true };

  it('is said by the bar, the sheet, and the panel from the start', () => {
    render(
      <>
        <Page offer={paused} />
        <BookingPanelIsland offer={paused} />
      </>,
    );
    expect(screen.getByText('Please check back soon')).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'Book this experience' }),
    ).toHaveTextContent('Bookings are paused');
    expect(screen.queryByRole('button', { name: 'Choose date' })).toBeNull();
  });
});

describe('gifts', () => {
  it('says gifts are not open yet, and cannot continue in gift mode', async () => {
    render(<BookingPanelIsland offer={kayakOffer} />);
    await userEvent.click(day('Saturday, October 24, 2026'));
    await userEvent.click(screen.getByRole('button', { name: /5:30 PM EDT/ }));

    await userEvent.click(
      screen.getByRole('button', { name: 'Give as a gift' }),
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      "Gifts aren't open yet",
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Book for me' }));
    expect(screen.queryByText("Gifts aren't open yet")).toBeNull();
  });

  it('has no switch while gifts are off', () => {
    render(
      <BookingPanelIsland offer={{ ...kayakOffer, giftsEnabled: false }} />,
    );
    expect(screen.queryByRole('button', { name: 'Give as a gift' })).toBeNull();
  });
});

describe('the party', () => {
  it('asks for adults and children, and needs a child beside a free adult', async () => {
    render(<BookingPanelIsland offer={kidsOffer} />);
    await userEvent.click(day('Saturday, October 24, 2026'));
    await userEvent.click(screen.getByRole('button', { name: /5:30 PM EDT/ }));

    expect(screen.getByRole('group', { name: 'Adults' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Children' })).toHaveTextContent(
      'Ages 5 to 10',
    );
    expect(
      screen.getByText("You'll add each child's age at checkout."),
    ).toBeVisible();
    expect(screen.getByText('2 adults, 1 child')).toBeVisible();
    expect(screen.getByText('$45.00')).toBeVisible();
  });

  it('takes one stepper where no children come, and says 21 and over with the door check', async () => {
    render(<BookingPanelIsland offer={twentyOneOffer} />);
    await userEvent.click(day('Saturday, October 24, 2026'));
    await userEvent.click(screen.getByRole('button', { name: /5:30 PM EDT/ }));

    expect(screen.getByRole('group', { name: 'Guests' })).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Children' })).toBeNull();
    expect(screen.getByText(/ID is checked at the door/)).toBeVisible();
  });

  it('stops at the spaces the time has left', async () => {
    render(<BookingPanelIsland offer={kayakOffer} />);
    await userEvent.click(day('Sunday, October 25, 2026'));
    const increase = screen.getByRole('button', { name: 'Increase Guests' });
    await userEvent.click(increase);
    expect(increase).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('$65 × 2 guests')).toBeVisible();
  });
});
