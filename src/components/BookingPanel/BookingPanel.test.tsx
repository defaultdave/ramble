import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { moduleClass } from '../../../tests/support/moduleClass';
import { BookingPanel, type DefaultBookingPanelProps } from './BookingPanel';
import styles from './BookingPanel.module.css';

const total = {
  label: '$65 × 2 guests',
  amountMinor: 13000,
  terms: 'Free cancellation until Fri, Oct 23, 5:30 PM.',
};

function setup(
  props: Partial<
    Pick<DefaultBookingPanelProps, 'total' | 'loading' | 'priceMinor'>
  > = {},
) {
  const onContinue = vi.fn();
  render(
    <BookingPanel
      priceMinor={6500}
      mode={<button type="button">Book for me</button>}
      holdNote="We hold your spaces for 10 minutes while you pay."
      onContinue={onContinue}
      {...props}
    >
      <p>Date, time, and party choices</p>
    </BookingPanel>,
  );
  return onContinue;
}

describe('BookingPanel paused', () => {
  it('keeps the price and says bookings are paused in place of the choices', () => {
    render(<BookingPanel state="paused" priceMinor={6500} />);
    expect(screen.getByText('$65')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Bookings are paused');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('BookingPanel layout', () => {
  it('puts the mode switch after the choices, and Continue after both', () => {
    setup({ total });
    const choices = screen.getByText('Date, time, and party choices');
    const modeSwitch = screen.getByRole('button', { name: 'Book for me' });
    const next = screen.getByRole('button', { name: 'Continue · $130.00' });
    const follows = (from: Element, to: Element) =>
      Boolean(
        from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    expect(follows(choices, modeSwitch)).toBe(true);
    expect(follows(modeSwitch, next)).toBe(true);
    expect(modeSwitch.parentElement).toHaveClass(moduleClass(styles.mode));
  });
});

describe('BookingPanel per-person line', () => {
  it('shows before a total exists', () => {
    setup();
    expect(screen.getByText('per person')).toBeVisible();
  });

  it('is left out once the total says the amount', () => {
    setup({ total });
    expect(screen.queryByText('per person')).not.toBeInTheDocument();
    expect(screen.getByText('$130.00')).toBeVisible();
  });

  it('shows in the sold-out panel, which has no total', () => {
    render(
      <BookingPanel
        state="sold-out"
        priceMinor={6500}
        similarHref="/browse"
        privateSessionHref="/private"
      />,
    );
    expect(screen.getByText('per person')).toBeVisible();
  });
});

describe('BookingPanel without a mode switch', () => {
  it('leaves out the switch row while gifts are off', () => {
    const { container } = render(
      <BookingPanel priceMinor={6500} onContinue={vi.fn()}>
        <p>Choices</p>
      </BookingPanel>,
    );
    expect(container.querySelector(`.${moduleClass(styles.mode)}`)).toBeNull();
    expect(screen.getByText('Choices')).toBeVisible();
  });
});

describe('BookingPanel', () => {
  it('is a labelled region showing the per-person price', () => {
    setup();
    expect(
      screen.getByRole('region', { name: 'Book this experience' }),
    ).toBeVisible();
    expect(screen.getByText('$65')).toBeVisible();
    expect(screen.getByText('per person')).toBeVisible();
  });

  it('reads a free experience as Free per person', () => {
    setup({ priceMinor: 0 });
    expect(screen.getByText('Free')).toBeVisible();
    expect(screen.getByText('per person')).toBeVisible();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('shows the mode switch and the choices', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Book for me' })).toBeVisible();
    expect(screen.getByText('Date, time, and party choices')).toBeVisible();
  });

  it('keeps Continue disabled until a total exists', async () => {
    const onContinue = setup();
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.queryByText('$130.00')).not.toBeInTheDocument();
  });

  it('shows the itemized total and terms, and puts the amount on Continue', () => {
    setup({ total });
    expect(screen.getByText('$65 × 2 guests')).toBeVisible();
    expect(screen.getByText('$130.00')).toBeVisible();
    expect(
      screen.getByText('Free cancellation until Fri, Oct 23, 5:30 PM.'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Continue · $130.00' }),
    ).toBeEnabled();
  });

  it('places the hold from Continue', async () => {
    const onContinue = setup({ total });
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue · $130.00' }),
    );
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('blocks a second press while the hold is being placed', async () => {
    const onContinue = setup({ total, loading: true });
    const button = screen.getByRole('button', { name: 'Continue · $130.00' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('shows the hold note under Continue', () => {
    setup({ total });
    expect(
      screen.getByText('We hold your spaces for 10 minutes while you pay.'),
    ).toBeVisible();
  });

  it('shows no terms line when none is given', () => {
    setup({ total: { label: total.label, amountMinor: total.amountMinor } });
    expect(screen.queryByText(/Free cancellation/)).not.toBeInTheDocument();
  });
});

describe('BookingPanel sold out', () => {
  function setupSoldOut() {
    render(
      <BookingPanel
        state="sold-out"
        priceMinor={6500}
        similarHref="/browse?like=kayak"
        privateSessionHref="/private-sessions/kayak"
      />,
    );
  }

  it('explains there are no open dates in an info alert', () => {
    setupSoldOut();
    expect(screen.getByRole('status')).toHaveTextContent(
      'No open dates right nowThe host adds new dates every week. See similar experiences, or ask about a private session.',
    );
  });

  it('links to similar experiences and to a private session', () => {
    setupSoldOut();
    expect(
      screen.getByRole('link', { name: 'See similar experiences' }),
    ).toHaveAttribute('href', '/browse?like=kayak');
    expect(
      screen.getByRole('link', { name: 'Ask about a private session' }),
    ).toHaveAttribute('href', '/private-sessions/kayak');
  });

  it('keeps the price and offers no booking action', () => {
    setupSoldOut();
    expect(screen.getByText('$65')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('BookingPanel props', () => {
  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof BookingPanel>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof BookingPanel>>().not.toHaveProperty(
      'style',
    );
  });
});
