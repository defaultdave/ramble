import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { StartPaymentResult } from '@/lib/checkout';
import type { CheckoutView } from '@/lib/pages/checkoutPage';
import { CheckoutPage, type CheckoutActions } from './CheckoutPage';
import narrow from './CheckoutPage.stories.module.css';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A hold with ten minutes left, as the page reads it.
const now = new Date('2026-10-23T14:00:00.000Z');

const view: CheckoutView = {
  holdId: uuid(1),
  sessionId: uuid(2),
  experience: {
    id: uuid(3),
    slug: 'sunset-kayak',
    title: 'Sunset kayak on the Hudson',
    hostName: 'Hudson Paddle Club',
  },
  expiresAt: '2026-10-23T14:09:42.000Z',
  serverNow: now.toISOString(),
  holdMinutes: 10,
  startsAt: '2026-10-24T21:30:00.000Z',
  timeZone: 'America/New_York',
  dateLabel: 'Sat, Oct 24',
  timeLabel: '5:30 PM',
  guests: 2,
  where: 'Pier 26 boathouse, Tribeca. Use the river-side door.',
  lines: [{ label: '$65 × 2 guests', amountMinor: 13_000 }],
  taxTreatment: 'not_taxable',
  taxMinor: 0,
  totalMinor: 13_000,
  cancellationLine: 'Free cancellation until Fri, Oct 23, 5:30 PM.',
  ageSubject: { ageRule: 'minimum_age', minAge: 14, maxAge: null },
  children: 0,
  party: [{ priceOptionId: uuid(4), quantity: 2 }],
  termsDocument: { id: uuid(5), href: '/legal/terms' },
  waiverDocument: { id: uuid(6), href: '/legal/waiver-hudson-paddle-club' },
};

const requiresPayment: StartPaymentResult = {
  status: 'requires_payment',
  orderId: uuid(7),
  reference: 'RMB-ABC234',
  payment: {
    provider: 'fake',
    clientSecret: 'fake_pay_demo_secret_0123456789abcdef',
  },
  amountDueMinor: 13_000,
  orderToken: 'order-token',
};

function actions(answer: StartPaymentResult): CheckoutActions {
  return {
    startPayment: fn(() => Promise.resolve(answer)),
    confirm: fn(() => Promise.resolve({ status: 'succeeded' as const })),
    reserve: fn(() =>
      Promise.resolve({ status: 'sold_out' as const, alternatives: [] }),
    ),
  };
}

const meta = {
  title: 'Pages/CheckoutPage',
  component: CheckoutPage,
  parameters: {
    layout: 'fullscreen',
    nextjs: { appDirectory: true },
    a11y: {
      config: {
        // Every story renders the page twice, once per color scheme, so landmarks repeat.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
          { id: 'landmark-no-duplicate-main', enabled: false },
        ],
      },
    },
  },
  args: { view, actions: actions(requiresPayment) },
} satisfies Meta<typeof CheckoutPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function fillDetails(root: HTMLElement) {
  const canvas = within(root);
  await userEvent.type(canvas.getByLabelText('Email'), 'alex@example.com');
  await userEvent.type(canvas.getByLabelText('Lead guest name'), 'Alex Rivera');
  await userEvent.click(canvas.getByLabelText(/Everyone is 14 or older/));
  await userEvent.click(canvas.getByLabelText(/I accept the waiver/));
  await userEvent.click(canvas.getByLabelText(/I accept Ramble's terms/));
}

/** Each color scheme is its own copy of the page, so every step is played in both. */
async function inEachScheme(
  canvasElement: HTMLElement,
  steps: (root: HTMLElement) => Promise<void>,
) {
  for (const root of canvasElement.querySelectorAll<HTMLElement>(
    '[data-scheme]',
  )) {
    await steps(root);
  }
}

const continueTo = async (root: HTMLElement) => {
  const canvas = within(root);
  await fillDetails(root);
  await userEvent.click(
    canvas.getByRole('button', { name: 'Continue to payment' }),
  );
};

/** The form as the guest first sees it: nothing ticked, the newsletter included (PRD-15). */
export const Details: Story = {};

export const ValidationErrors: Story = {
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await userEvent.click(
        canvas.getByRole('button', { name: 'Continue to payment' }),
      );
      await expect(await canvas.findByText('Check your details')).toBeVisible();
    }),
};

export const PartyWithChildren: Story = {
  args: {
    view: {
      ...view,
      children: 2,
      ageSubject: { ageRule: 'minimum_age', minAge: 6, maxAge: null },
      lines: [
        { label: '$65 × 2 adults', amountMinor: 13_000 },
        { label: '$30 × 2 children', amountMinor: 6000 },
      ],
      totalMinor: 19_000,
      guests: 4,
    },
  },
};

export const TwentyOnePlusNoWaiver: Story = {
  args: {
    view: {
      ...view,
      ageSubject: { ageRule: 'twenty_one_plus', minAge: null, maxAge: null },
      waiverDocument: null,
    },
  },
};

export const Payment: Story = {
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await continueTo(root);
      await expect(await canvas.findByText('Demo payment form')).toBeVisible();
    }),
};

export const ConnectionLostAfterPay: Story = {
  args: {
    actions: {
      ...actions(requiresPayment),
      confirm: fn(() => Promise.reject(new Error('offline'))),
    },
  },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await continueTo(root);
      await canvas.findByText('Demo payment form');
      await userEvent.type(
        canvas.getByLabelText('Card number'),
        '4242424242424242',
      );
      await userEvent.type(
        canvas.getByLabelText('Expiry date, month and year'),
        '1299',
      );
      await userEvent.type(canvas.getByLabelText('Security code'), '123');
      await userEvent.type(canvas.getByLabelText('ZIP code'), '10001');
      await userEvent.click(
        canvas.getByRole('button', { name: 'Pay $130.00' }),
      );
      await expect(
        await canvas.findByText("We're checking your payment"),
      ).toBeVisible();
      await expect(
        canvas.getByRole('link', { name: 'Check again' }),
      ).toBeVisible();
    }),
};

/** S6, the timer ran out while the guest typed. */
export const HoldExpired: Story = {
  args: { view: { ...view, expiresAt: '2026-10-23T13:59:00.000Z' } },
};

/** S6, answered by `startPayment` with the spaces still there. */
export const HoldExpiredCanRehold: Story = {
  args: {
    actions: actions({
      status: 'hold_expired',
      canRehold: true,
      spacesLeft: 6,
    }),
  },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await continueTo(root);
      await expect(
        await canvas.findByText(/5:30 PM still has 6 spaces/),
      ).toBeVisible();
    }),
};

/** S6, the party no longer fits. */
export const HoldExpiredCannotRehold: Story = {
  args: {
    actions: actions({
      status: 'hold_expired',
      canRehold: false,
      spacesLeft: 1,
    }),
  },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await continueTo(root);
      await expect(
        await canvas.findByRole('link', { name: 'Choose another date' }),
      ).toBeVisible();
    }),
};

/** S7. */
export const SoldOutWithAlternatives: Story = {
  args: {
    actions: actions({
      status: 'sold_out',
      alternatives: [
        {
          sessionId: uuid(11),
          startsAt: '2026-10-25T21:30:00.000Z',
          timeZone: 'America/New_York',
          spacesLeft: 2,
        },
        {
          sessionId: uuid(12),
          startsAt: '2026-10-31T21:15:00.000Z',
          timeZone: 'America/New_York',
          spacesLeft: 10,
        },
        {
          sessionId: uuid(13),
          startsAt: '2026-11-01T21:00:00.000Z',
          timeZone: 'America/New_York',
          spacesLeft: 8,
        },
      ],
    }),
  },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await continueTo(root);
      await expect(
        await canvas.findByText('Other dates for 2 guests'),
      ).toBeVisible();
    }),
};

export const TooManyTries: Story = {
  args: { actions: actions({ status: 'too_many_tries' }) },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await continueTo(root);
      await expect(await canvas.findByText('Too many tries')).toBeVisible();
    }),
};

export const Maintenance: Story = { args: { maintenance: true } };

/**
 * The longest time a hold can show, in a 320px column: the pill shrinks and wraps inside the
 * header instead of running past it. The column holds the page at the phone's width whatever the
 * browser window is, so only the pill's edge is measured here.
 */
export const LongTimerAt320: Story = {
  args: { view: { ...view, expiresAt: '2026-10-23T14:59:59.000Z' } },
  parameters: {
    a11y: {
      config: {
        // This story measures layout. Axe reads the button's colors against the wrong layer inside
        // the fixed-width column; every other story checks the same elements' contrast.
        rules: [
          { id: 'landmark-unique', enabled: false },
          { id: 'landmark-no-duplicate-banner', enabled: false },
          { id: 'landmark-no-duplicate-main', enabled: false },
          { id: 'color-contrast', enabled: false },
        ],
      },
    },
  },
  decorators: [
    (Story) => (
      <div className={narrow.narrow} data-testid="narrow">
        <Story />
      </div>
    ),
  ],
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await expect(canvas.getByRole('timer')).toHaveTextContent('59:59');
      const column = root.querySelector<HTMLElement>('[data-testid="narrow"]');
      const timer = canvas.getByRole('timer');
      if (!column) throw new Error('The narrow column is missing');
      await expect(timer.getBoundingClientRect().right).toBeLessThanOrEqual(
        column.getBoundingClientRect().right,
      );
    }),
};
