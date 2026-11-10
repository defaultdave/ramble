import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { orderA, orderB } from '@/lib/bookingEmails.fixtures';
import type { CancelFacts } from '@/lib/cancelBooking';
import {
  manageView,
  managePageState,
  type ManageQuery,
  type ManageView,
} from '@/lib/manageBooking';
import {
  ManageBooking,
  ManageTooManyTries,
  type ManageBookingProps,
} from './ManageBooking';

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
const afterWindow = new Date('2026-11-06T22:00:00Z');

const cancelledFacts: CancelFacts = {
  ...facts,
  status: 'cancelled',
  refundedTicketMinor: 21_500,
  refundedTaxMinor: 1_912,
  commissionReturnedMinor: 3_225,
};
const cancelledView = manageView(
  { ...orderA, status: 'cancelled' },
  cancelledFacts,
  inWindow,
);

/** The page as the route builds it: the view, and what the query says about it. */
function page(view: ManageView, query: ManageQuery = {}): ManageBookingProps {
  return {
    view,
    token,
    cancelAction: fn(() => Promise.resolve()),
    ...managePageState(view, query),
  };
}

const meta = {
  title: 'Pages/ManageBooking',
  component: ManageBooking,
  args: page(manageView(orderA, facts, inWindow)),
  parameters: {
    a11y: {
      config: {
        // Every story renders the state twice, once per color scheme, and outside the page's main.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'region', enabled: false },
        ],
      },
    },
  },
} satisfies Meta<typeof ManageBooking>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const RefundShownFirstMobile: Story = { parameters: mobile };
export const RefundShownFirstDesktop: Story = { parameters: desktop };

export const ConfirmStep: Story = {
  args: page(manageView(orderA, facts, inWindow), { confirm: '1' }),
  parameters: mobile,
};

export const NoRefundAfterTheWindow: Story = {
  args: page(manageView(orderA, facts, afterWindow)),
  parameters: mobile,
};

export const PaidWithAGift: Story = {
  args: page(
    manageView(
      orderB,
      {
        ...facts,
        amountDueMinor: 5_500,
        giftAppliedMinor: 4_000,
        ticketSubtotalMinor: 9_500,
        taxMinor: 0,
        totalMinor: 9_500,
        sessionStartsAt: orderB.startsAt,
        freeCancelUntil: new Date('2026-12-01T00:00:00Z'),
      },
      inWindow,
    ),
  ),
  parameters: mobile,
};

export const Cancelled: Story = {
  args: page(cancelledView),
  parameters: mobile,
};

export const SessionStarted: Story = {
  args: page(manageView(orderA, facts, orderA.startsAt)),
  parameters: mobile,
};

export const JustCancelled: Story = {
  args: page(cancelledView, { result: 'cancelled' }),
  parameters: mobile,
};

export const RefundChanged: Story = {
  args: page(manageView(orderA, facts, inWindow), { result: 'terms_changed' }),
  parameters: mobile,
};

export const RefundCouldNotStart: Story = {
  args: page(manageView(orderA, facts, inWindow), {
    result: 'refund_unavailable',
  }),
  parameters: mobile,
};

export const TooManyTriesWhileCancelling: Story = {
  args: page(manageView(orderA, facts, inWindow), { result: 'rate_limited' }),
  parameters: mobile,
};

export const TooManyTriesPage: Story = {
  render: () => <ManageTooManyTries retryAfterSeconds={240} />,
  parameters: mobile,
};
