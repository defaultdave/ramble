import { formatPrice } from './money';
import { guestsLabel, type OrderSummaryLine } from './orderSummary';
import { checkoutPath, orderPath } from './routes';

// TODO(U-047b): replaced by the checkout page; the hold id, the order reference, and this module go with it.
export const demoHoldId = '00000000-0000-4000-8000-0000000000d1';
export const demoOrderReference = 'RMB-DEMO01';

/**
 * The checkout a Book button leads to. The experience rides along for the real checkout; the stub
 * ignores it, because naming it would need a guest read, and the checkout routes load nothing
 * that names Sentry (tests/checkout-no-sentry.test.ts) while that read does.
 */
export const demoCheckoutPath = (experienceId: string) =>
  `${checkoutPath(demoHoldId)}?experience=${experienceId}`;

export const demoOrderPath = orderPath(demoOrderReference);

export type DemoSummary = {
  title: string;
  guests: number;
  lines: OrderSummaryLine[];
  totalMinor: number;
};

const guests = 2;
const pricePerPersonMinor = 8500;

/** The one line the demo checkout and confirmation show. */
export const demoSummary: DemoSummary = {
  title: 'Hand-rolled pasta class',
  guests,
  lines: [
    {
      label: `${formatPrice(pricePerPersonMinor)} × ${guestsLabel(guests)}`,
      amountMinor: pricePerPersonMinor * guests,
    },
  ],
  totalMinor: pricePerPersonMinor * guests,
};
