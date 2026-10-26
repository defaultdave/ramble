import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import {
  OrderSummary,
  type BookingOrderSummaryProps,
  type GiftOrderSummaryProps,
} from '@/components/OrderSummary';
import styles from './OrderSummary.stories.module.css';

const meta = {
  title: 'Composites/OrderSummary',
  component: OrderSummary,
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OrderSummary>;

export default meta;

// OrderSummary is a union on kind, which Storybook cannot infer args from, so each story names its props.
type BookingStory = StoryObj<BookingOrderSummaryProps>;
type GiftStory = StoryObj<GiftOrderSummaryProps>;

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
  onToggle: fn(),
} satisfies BookingOrderSummaryProps;

const taxable = {
  ...booking,
  taxTreatment: 'taxable',
  taxMinor: 1509,
  totalMinor: 18509,
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
  onToggle: fn(),
} satisfies GiftOrderSummaryProps;

export const BookingCollapsed: BookingStory = { args: booking };
export const BookingExpanded: BookingStory = {
  args: { ...booking, expanded: true },
};
export const BookingCollapsedTaxable: BookingStory = { args: taxable };
export const BookingExpandedTaxable: BookingStory = {
  args: { ...taxable, expanded: true },
};
export const BookingExpandedUnknownTax: BookingStory = {
  args: { ...booking, expanded: true, taxTreatment: 'unknown' },
};
export const BookingExpandedAdultsAndChildren: BookingStory = {
  args: {
    ...booking,
    expanded: true,
    guests: 3,
    lines: [
      { label: '$85 × 2 adults', amountMinor: 17000 },
      { label: '$45 × 1 child', amountMinor: 4500 },
    ],
    totalMinor: 21500,
  },
};
export const GiftCollapsed: GiftStory = { args: gift };
export const GiftExpanded: GiftStory = { args: { ...gift, expanded: true } };

// The component is stateless; this harness holds the state a caller would, to show the disclosure working.
function Toggleable(args: BookingOrderSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <OrderSummary
      {...args}
      expanded={expanded}
      onToggle={() => {
        setExpanded((current) => !current);
      }}
    />
  );
}

export const TogglesOnPress: BookingStory = {
  args: taxable,
  render: (args) => <Toggleable {...args} />,
  play: async ({ canvasElement }) => {
    // The story renders once per color scheme; the first copy is enough.
    const [toggle] = within(canvasElement).getAllByRole('button');
    if (!toggle) throw new Error('No toggle rendered');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  },
};
