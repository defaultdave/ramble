import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { BookingBar } from './BookingBar';

describe('BookingBar default', () => {
  it('shows the lowest price and the next open date', () => {
    render(
      <BookingBar
        priceMinor={8500}
        nextDate="Sat, Oct 24"
        onChooseDate={vi.fn()}
      />,
    );
    expect(screen.getByText('From $85')).toBeVisible();
    expect(screen.getByText('per person · next Sat, Oct 24')).toBeVisible();
  });

  it('leaves the next date out when it is not known', () => {
    render(<BookingBar priceMinor={8500} onChooseDate={vi.fn()} />);
    expect(screen.getByText('per person')).toBeVisible();
  });

  it('opens date choice from Choose date', async () => {
    const onChooseDate = vi.fn();
    render(<BookingBar priceMinor={8500} onChooseDate={onChooseDate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    expect(onChooseDate).toHaveBeenCalledOnce();
  });
});

describe('BookingBar date chosen', () => {
  const chosen = {
    state: 'date-chosen',
    when: 'Sat, Oct 24 · 2:00 PM',
    guests: 2,
    totalMinor: 17000,
    onContinue: vi.fn(),
  } as const;

  it('shows the chosen slot, the party, and the amount charged', () => {
    render(<BookingBar {...chosen} />);
    expect(screen.getByText('Sat, Oct 24 · 2:00 PM')).toBeVisible();
    expect(screen.getByText('2 guests · $170.00')).toBeVisible();
  });

  it('places the hold from Continue', async () => {
    const onContinue = vi.fn();
    render(<BookingBar {...chosen} onContinue={onContinue} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('blocks a second press while the hold is being placed', async () => {
    const onContinue = vi.fn();
    render(<BookingBar {...chosen} loading onContinue={onContinue} />);
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onContinue).not.toHaveBeenCalled();
  });
});

describe('BookingBar sold out', () => {
  it('says there are no open dates and links to similar experiences', () => {
    render(<BookingBar state="sold-out" similarHref="/browse?like=kayak" />);
    expect(screen.getByText('No open dates')).toBeVisible();
    expect(screen.getByText('New dates are added weekly')).toBeVisible();
    expect(screen.getByRole('link', { name: 'See similar' })).toHaveAttribute(
      'href',
      '/browse?like=kayak',
    );
  });

  it('offers no booking action', () => {
    render(<BookingBar state="sold-out" similarHref="/browse" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('BookingBar paused', () => {
  it('says bookings are paused and offers nothing to press', () => {
    render(<BookingBar state="paused" />);
    expect(screen.getByText('Bookings are paused')).toBeVisible();
    expect(screen.getByText('Please check back soon')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('BookingBar props', () => {
  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof BookingBar>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof BookingBar>>().not.toHaveProperty(
      'style',
    );
  });
});
