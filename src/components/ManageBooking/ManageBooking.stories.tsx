import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { orderA, orderB } from '@/lib/bookingEmails.fixtures';
import type { CancelBookingResult, CancelFacts } from '@/lib/cancelBooking';
import { manageView } from '@/lib/manageBooking';
import { ManageBooking, ManageTooManyTries } from './ManageBooking';

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

const answer = (result: CancelBookingResult) =>
  fn(() => Promise.resolve(result));

const meta = {
  title: 'Pages/ManageBooking',
  component: ManageBooking,
  args: {
    view: manageView(orderA, facts, inWindow),
    token,
    cancel: answer({ status: 'already_cancelled' }),
  },
  parameters: {
    // The component asks the app router to render again after a changed refund.
    nextjs: { appDirectory: true },
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

/** The story renders once per color scheme; the first copy is enough. */
function firstCopy(canvasElement: HTMLElement) {
  const copy = canvasElement.querySelector<HTMLElement>('[data-scheme]');
  if (!copy) throw new Error('No color scheme copy rendered');
  return within(copy);
}

async function confirmCancel(canvasElement: HTMLElement) {
  const canvas = firstCopy(canvasElement);
  await userEvent.click(
    await canvas.findByRole('button', { name: 'Cancel and refund $234.12' }),
  );
  await userEvent.click(
    await canvas.findByRole('button', { name: 'Cancel and refund $234.12' }),
  );
  return canvas;
}

export const RefundShownFirstMobile: Story = { parameters: mobile };
export const RefundShownFirstDesktop: Story = { parameters: desktop };

export const AskingAgain: Story = {
  parameters: mobile,
  play: async ({ canvasElement }) => {
    const canvas = firstCopy(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Cancel and refund $234.12' }),
    );
    await expect(
      await canvas.findByRole('group', { name: 'Cancel this booking?' }),
    ).toBeVisible();
  },
};

export const NoRefundAfterTheWindow: Story = {
  args: { view: manageView(orderA, facts, afterWindow) },
  parameters: mobile,
};

export const PaidWithAGift: Story = {
  args: {
    view: manageView(
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
  },
  parameters: mobile,
};

export const Cancelled: Story = {
  args: {
    view: manageView(
      { ...orderA, status: 'cancelled' },
      { ...facts, status: 'cancelled' },
      inWindow,
    ),
  },
  parameters: mobile,
};

export const SessionStarted: Story = {
  args: { view: manageView(orderA, facts, orderA.startsAt) },
  parameters: mobile,
};

export const JustCancelled: Story = {
  args: {
    cancel: answer({
      status: 'cancelled',
      refundMinor: 23_412,
      giftReinstated: false,
      refundEta: 'Your bank usually shows it within 5 to 10 business days.',
    }),
  },
  parameters: mobile,
  play: async ({ canvasElement }) => {
    const canvas = await confirmCancel(canvasElement);
    await expect(
      await canvas.findByText('Your booking is cancelled'),
    ).toBeVisible();
  },
};

export const RefundChanged: Story = {
  args: { cancel: answer({ status: 'terms_changed', refundMinor: 0 }) },
  parameters: mobile,
  play: async ({ canvasElement }) => {
    const canvas = await confirmCancel(canvasElement);
    await expect(
      await canvas.findByText('The refund has changed'),
    ).toBeVisible();
  },
};

export const RefundCouldNotStart: Story = {
  args: {
    cancel: answer({ status: 'refund_unavailable', reason: 'no_payment' }),
  },
  parameters: mobile,
  play: async ({ canvasElement }) => {
    const canvas = await confirmCancel(canvasElement);
    await expect(
      await canvas.findByText("We couldn't start your refund"),
    ).toBeVisible();
  },
};

export const TooManyTriesWhileCancelling: Story = {
  args: { cancel: answer({ status: 'rate_limited', retryAfterSeconds: 240 }) },
  parameters: mobile,
  play: async ({ canvasElement }) => {
    const canvas = await confirmCancel(canvasElement);
    await expect(await canvas.findByText('Too many tries')).toBeVisible();
  },
};

export const TooManyTriesPage: Story = {
  render: () => <ManageTooManyTries retryAfterSeconds={240} />,
  parameters: mobile,
};
