import { describe, expect, it } from 'vitest';
import {
  bookingMeta,
  giftMeta,
  guestsLabel,
  orderSummaryAmounts,
  type TaxTreatment,
} from './orderSummary';

describe('guestsLabel', () => {
  it.each([
    [1, '1 guest'],
    [2, '2 guests'],
    [6, '6 guests'],
  ])('labels %i guests', (count, label) => {
    expect(guestsLabel(count)).toBe(label);
  });

  it.each([0, -1, 1.5, Number.NaN])('throws on %s', (count) => {
    expect(() => guestsLabel(count)).toThrow(RangeError);
  });
});

describe('meta lines', () => {
  it('joins the booking date, time, and party', () => {
    expect(
      bookingMeta({
        dateLabel: 'Sat, Oct 24',
        timeLabel: '2:00 PM',
        guests: 2,
      }),
    ).toBe('Sat, Oct 24 · 2:00 PM · 2 guests');
  });

  it('names the gift recipient and delivery date', () => {
    expect(giftMeta({ recipientName: 'Sam', deliveryLabel: 'Dec 24' })).toBe(
      'Gift for Sam · email on Dec 24',
    );
  });
});

const lines = [{ label: '$85 × 2 guests', amountMinor: 17000 }];

function amounts(
  taxTreatment: TaxTreatment,
  taxMinor: number,
  totalMinor: number,
) {
  return orderSummaryAmounts({ lines, taxTreatment, taxMinor, totalMinor });
}

describe('orderSummaryAmounts tax line (PRD-78)', () => {
  it('shows the tax line for a taxable experience and adds it to the total', () => {
    expect(amounts('taxable', 1509, 18509)).toEqual({
      lines: [{ label: '$85 × 2 guests', amount: '$170.00' }],
      tax: { label: 'Sales tax', amount: '$15.09' },
      total: '$185.09',
    });
  });

  it('shows a $0.00 tax line when a taxable experience rounds to nothing', () => {
    expect(amounts('taxable', 0, 17000).tax).toEqual({
      label: 'Sales tax',
      amount: '$0.00',
    });
  });

  it.each(['not_taxable', 'unknown'] as const)(
    'shows no tax line when the experience is %s',
    (treatment) => {
      expect(amounts(treatment, 0, 17000)).toEqual({
        lines: [{ label: '$85 × 2 guests', amount: '$170.00' }],
        tax: null,
        total: '$170.00',
      });
    },
  );

  it.each(['not_taxable', 'unknown'] as const)(
    'refuses tax on an experience that is %s',
    (treatment) => {
      expect(() => amounts(treatment, 1509, 18509)).toThrow(RangeError);
    },
  );
});

describe('orderSummaryAmounts total', () => {
  it('itemizes every line', () => {
    const result = orderSummaryAmounts({
      lines: [
        { label: '$85 × 2 adults', amountMinor: 17000 },
        { label: '$45 × 1 child', amountMinor: 4500 },
      ],
      taxTreatment: 'not_taxable',
      taxMinor: 0,
      totalMinor: 21500,
    });
    expect(result.lines.map((line) => line.amount)).toEqual([
      '$170.00',
      '$45.00',
    ]);
    expect(result.total).toBe('$215.00');
  });

  it.each([
    ['too low', 16999],
    ['too high', 17001],
  ])('refuses a total that is %s for its lines', (_label, totalMinor) => {
    expect(() => amounts('not_taxable', 0, totalMinor)).toThrow(RangeError);
  });

  it('refuses a total that leaves tax out', () => {
    expect(() => amounts('taxable', 1509, 17000)).toThrow(RangeError);
  });

  it('refuses no lines', () => {
    expect(() =>
      orderSummaryAmounts({
        lines: [],
        taxTreatment: 'not_taxable',
        taxMinor: 0,
        totalMinor: 0,
      }),
    ).toThrow(RangeError);
  });

  it('refuses more lines than a booking can have', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      label: `Line ${String(index)}`,
      amountMinor: 100,
    }));
    expect(() =>
      orderSummaryAmounts({
        lines: many,
        taxTreatment: 'not_taxable',
        taxMinor: 0,
        totalMinor: 500,
      }),
    ).toThrow(RangeError);
  });
});
