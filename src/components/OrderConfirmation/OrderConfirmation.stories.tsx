import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import {
  appUrl,
  fakeManageToken,
  orderA,
  orderB,
} from '@/lib/bookingEmails.fixtures';
import type { BookingEmailSource } from '@/lib/bookingEmails';
import { orderPageView } from '@/lib/orderReceipt';
import { OrderConfirmation } from './OrderConfirmation';

const token = 'A'.repeat(43);

function view(source: BookingEmailSource) {
  return orderPageView(source, { manageToken: fakeManageToken, appUrl });
}

// The not-found state is the route group's own notice, shown in Pages/Notices.
const meta = {
  title: 'Pages/OrderConfirmation',
  component: OrderConfirmation,
  args: {
    view: view(orderA),
    token,
    // Never settles, so the pending story stays on screen.
    checkStatus: fn(() => new Promise<never>(() => undefined)),
  },
  parameters: {
    // The poller reads the app router.
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
} satisfies Meta<typeof OrderConfirmation>;

export default meta;
type Story = StoryObj<typeof meta>;

const mobile = { viewport: { value: 'mobile1', isRotated: false } };
const desktop = { viewport: { value: 'desktop', isRotated: false } };

export const ConfirmedMobile: Story = { parameters: mobile };
export const ConfirmedDesktop: Story = { parameters: desktop };
export const ConfirmedWithGiftNoMeetingPoint: Story = {
  args: { view: view(orderB) },
  parameters: mobile,
};
export const PendingS9: Story = {
  args: { view: view({ ...orderA, status: 'pending_payment' }) },
  parameters: mobile,
};
export const PaymentFailed: Story = {
  args: { view: view({ ...orderA, status: 'payment_failed' }) },
  parameters: mobile,
};
export const RefundedAfterLapse: Story = {
  args: { view: view({ ...orderA, status: 'refunded_after_lapse' }) },
  parameters: mobile,
};
export const Closed: Story = {
  args: { view: view({ ...orderA, status: 'cancelled' }) },
  parameters: desktop,
};
