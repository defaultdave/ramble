import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import {
  OrderSummary,
  type BookingOrderSummaryProps,
  type GiftOrderSummaryProps,
} from './OrderSummary';

const booking = {
  title: 'Hand-rolled pasta class',
  dateLabel: 'Sat, Oct 24',
  timeLabel: '2:00 PM',
  guests: 2,
  where: 'Carroll Gardens, Brooklyn. Meet at the studio door.',
  lines: [{ label: '$85 × 2 guests', amountMinor: 17000 }],
  taxTreatment: 'not_taxable',
  taxMinor: 0,
  totalMinor: 17000,
  terms: 'Free cancellation until Fri, Oct 23, 2:00 PM.',
  expanded: false,
  onToggle: vi.fn(),
} satisfies BookingOrderSummaryProps;

const gift = {
  kind: 'gift',
  title: 'Hand-rolled pasta class',
  recipientName: 'Sam',
  deliveryLabel: 'Dec 24',
  where: 'Carroll Gardens, Brooklyn. Sam picks the date.',
  lines: [{ label: '$85 × 2 guests', amountMinor: 17000 }],
  taxTreatment: 'not_taxable',
  taxMinor: 0,
  totalMinor: 17000,
  terms: 'Valid 12 months. Refunded to you if not redeemed.',
  expanded: false,
  onToggle: vi.fn(),
} satisfies GiftOrderSummaryProps;

describe('OrderSummary collapsed', () => {
  it('shows the title, when, and total in one disclosure button', () => {
    render(<OrderSummary {...booking} />);
    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAccessibleName(
      'Hand-rolled pasta class Sat, Oct 24 · 2:00 PM · 2 guests $170.00',
    );
  });

  it('announces that it is collapsed and keeps the itemization hidden', () => {
    render(<OrderSummary {...booking} />);
    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Total charged')).not.toBeVisible();
    expect(screen.getByText('$85 × 2 guests')).not.toBeVisible();
  });

  it('points the button at the details it controls', () => {
    render(<OrderSummary {...booking} />);
    const controlled = screen.getByRole('button').getAttribute('aria-controls');
    expect(controlled).toBeTruthy();
    expect(document.getElementById(controlled ?? '')).toContainElement(
      screen.getByText('Total charged'),
    );
  });

  it('calls onToggle when pressed', async () => {
    const onToggle = vi.fn();
    render(<OrderSummary {...booking} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe('OrderSummary expanded', () => {
  it('announces that it is expanded and offers Hide', () => {
    render(<OrderSummary {...booking} expanded />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hide')).toBeVisible();
  });

  it('itemizes the lines, the total charged, and the terms', () => {
    render(<OrderSummary {...booking} expanded />);
    expect(screen.getByText('$85 × 2 guests')).toBeVisible();
    expect(screen.getByText('Total charged')).toBeVisible();
    expect(screen.getAllByText('$170.00')).toHaveLength(3);
    expect(
      screen.getByText('Free cancellation until Fri, Oct 23, 2:00 PM.'),
    ).toBeVisible();
    expect(
      screen.getByText('Carroll Gardens, Brooklyn. Meet at the studio door.'),
    ).toBeVisible();
  });

  it('shows the experience photo in the thumbnail frame', () => {
    render(
      <OrderSummary
        {...booking}
        expanded
        thumbnail={<div role="img" aria-label="Pasta on a table" />}
      />,
    );
    expect(screen.getByRole('img', { name: 'Pasta on a table' })).toBeVisible();
  });
});

describe('OrderSummary tax line (PRD-78)', () => {
  it('shows the tax line and a total that includes it for a taxable experience', () => {
    render(
      <OrderSummary
        {...booking}
        expanded
        taxTreatment="taxable"
        taxMinor={1509}
        totalMinor={18509}
      />,
    );
    expect(screen.getByText('Sales tax')).toBeVisible();
    expect(screen.getByText('$15.09')).toBeVisible();
    expect(screen.getAllByText('$185.09')).toHaveLength(2);
  });

  it.each(['not_taxable', 'unknown'] as const)(
    'shows no tax line when the experience is %s',
    (taxTreatment) => {
      render(
        <OrderSummary {...booking} expanded taxTreatment={taxTreatment} />,
      );
      expect(screen.queryByText('Sales tax')).not.toBeInTheDocument();
    },
  );

  it('refuses to render a total that is not the sum of its parts', () => {
    // React logs the thrown render error; the assertion is on the throw.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(<OrderSummary {...booking} totalMinor={17001} />),
    ).toThrow(RangeError);
    vi.restoreAllMocks();
  });
});

describe('OrderSummary gift', () => {
  it('describes the gift recipient and delivery instead of a session', () => {
    render(<OrderSummary {...gift} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Hand-rolled pasta class Gift for Sam · email on Dec 24 $170.00',
    );
  });

  it('shows the gift terms when expanded', () => {
    render(<OrderSummary {...gift} expanded />);
    expect(
      screen.getByText('Valid 12 months. Refunded to you if not redeemed.'),
    ).toBeVisible();
  });
});

describe('OrderSummary props', () => {
  it('rejects className and style', () => {
    // Composites own their styling; callers cannot override it.
    expectTypeOf<ComponentProps<typeof OrderSummary>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof OrderSummary>>().not.toHaveProperty(
      'style',
    );
  });
});
