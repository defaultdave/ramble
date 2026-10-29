import { describe, expect, it } from 'vitest';
import { demoCheckoutPath, demoOrderPath, demoSummary } from './demoCheckout';
import { orderSummaryAmounts } from './orderSummary';

// Behaviours under test, one per decision, branch or risk:
// - the checkout path carries the hold and the experience; the order path carries the fixed reference
// - the summary is one line for two guests whose total is what the summary component will accept

describe('demo paths', () => {
  it('leads to the checkout with the experience, and then to the fixed order', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(demoCheckoutPath(id)).toBe(
      `/checkout/00000000-0000-4000-8000-0000000000d1?experience=${id}`,
    );
    expect(demoOrderPath).toBe('/orders/RMB-DEMO01');
  });
});

describe('demoSummary', () => {
  it('names no experience, since any experience can lead to it', () => {
    expect(demoSummary.title).toBe('Your experience (demo)');
  });

  it('is one line for two guests, and its parts add up to the total', () => {
    expect(demoSummary.lines).toEqual([
      { label: '$85 × 2 guests', amountMinor: 17000 },
    ]);
    expect(
      orderSummaryAmounts({
        lines: demoSummary.lines,
        taxTreatment: demoSummary.taxTreatment,
        taxMinor: demoSummary.taxMinor,
        totalMinor: demoSummary.totalMinor,
      }).total,
    ).toBe('$170.00');
  });
});
