import { formatPrice } from './money';
import {
  guestsLabel,
  type OrderSummaryLine,
  type TaxTreatment,
} from './orderSummary';
import { checkoutPath, orderPath } from './routes';

// TODO(U-041): remove the demo click-through: the hold id, the order reference, and this module.
const demoHoldId = '00000000-0000-4000-8000-0000000000d1';
const demoOrderReference = 'RMB-DEMO01';

/**
 * The checkout a Book button leads to. The experience rides along for the real checkout; the stub
 * ignores it, because naming it would need a guest read, and the checkout routes load nothing
 * that names Sentry (tests/checkout-no-sentry.test.ts) while that read does.
 */
export const demoCheckoutPath = (experienceId: string) =>
  `${checkoutPath(demoHoldId)}?experience=${experienceId}`;

export const demoOrderPath = orderPath(demoOrderReference);

/** Whether the reference is the fixed one the demo checkout ends at. */
export const isDemoOrder = (reference: string) =>
  orderPath(reference) === demoOrderPath;

export type DemoSummary = {
  title: string;
  dateLabel: string;
  timeLabel: string;
  guests: number;
  where: string;
  terms: string;
  taxTreatment: TaxTreatment;
  taxMinor: number;
  lines: OrderSummaryLine[];
  totalMinor: number;
};

const guests = 2;
const pricePerPersonMinor = 8500;

/** The one line the demo checkout and confirmation show. */
export const demoSummary: DemoSummary = {
  title: 'Your experience (demo)',
  dateLabel: 'Sat, Nov 14',
  timeLabel: '2:00 PM',
  guests,
  where: 'Demo order. The real meeting point arrives with the booking.',
  terms: 'Demo order. Nothing is charged and nothing is booked.',
  taxTreatment: 'not_taxable',
  taxMinor: 0,
  lines: [
    {
      label: `${formatPrice(pricePerPersonMinor)} × ${guestsLabel(guests)}`,
      amountMinor: pricePerPersonMinor * guests,
    },
  ],
  totalMinor: pricePerPersonMinor * guests,
};

/** Whether a checkout address is the demo's, which shows the stub before any hold is read. */
export function isDemoHold(holdId: string): boolean {
  return holdId.toLowerCase() === demoHoldId;
}
