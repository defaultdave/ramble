import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn, userEvent, within } from 'storybook/test';
import {
  FakePaymentForm,
  type FakePaymentFormProps,
} from '@/components/FakePaymentForm';
import { fakeConfirmResult } from '@/lib/fakePaymentInput';
import type { FakeConfirmResult } from '@/lib/fakePayment';
import styles from './FakePaymentForm.stories.module.css';

type Plan = Parameters<typeof fakeConfirmResult>[0];

const mockConfirm = (confirm: FakePaymentFormProps['confirm']) => fn(confirm);

/** The gateway as these stories play it: the plan the form sends decides the answer. */
const gateway = (answer: (plan: Plan) => FakeConfirmResult) =>
  mockConfirm(({ plan }) => Promise.resolve(answer(plan)));

/** A card that asks for 3-D Secure, then answers the guest's pass or fail. */
const challengeGateway = () =>
  gateway((plan) =>
    plan.outcome === 'requires_action'
      ? { status: 'requires_action' }
      : fakeConfirmResult(plan),
  );

const meta = {
  title: 'Composites/FakePaymentForm',
  component: FakePaymentForm,
  parameters: {
    a11y: {
      config: {
        // Every story renders the form twice, once per color scheme, so the landmark repeats.
        rules: [{ id: 'landmark-unique', enabled: false }],
      },
    },
  },
  args: {
    payment: { id: 'pay_demo', clientSecret: 'pay_demo_secret_demo' },
    amountMinor: 13_000,
    confirm: gateway(fakeConfirmResult),
    onSucceeded: fn(),
    onConnectionLost: fn(),
  },
  decorators: [
    (Story) => (
      <div className={styles.frame}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FakePaymentForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each color scheme is its own copy of the form, so every step is played in both. */
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

async function fillCard(root: HTMLElement, number: string, expiry = '1299') {
  const canvas = within(root);
  await userEvent.type(canvas.getByLabelText('Card number'), number);
  await userEvent.type(
    canvas.getByLabelText('Expiry date, month and year'),
    expiry,
  );
  await userEvent.type(canvas.getByLabelText('Security code'), '123');
  await userEvent.type(canvas.getByLabelText('ZIP code'), '10001');
}

async function pay(root: HTMLElement) {
  await userEvent.click(
    within(root).getByRole('button', { name: 'Pay $130.00' }),
  );
}

/** The demo notice, the wallet buttons, and an empty card. */
export const Empty: Story = {};

/** A test card typed in, ready to pay. */
export const Filled: Story = {
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, (root) => fillCard(root, '4242424242424242')),
};

/** Pay tapped with nothing entered: every error is announced and focus moves to the first field. */
export const FieldErrors: Story = {
  play: ({ canvasElement }) => inEachScheme(canvasElement, (root) => pay(root)),
};

/** A number that is not on the test card list is refused before anything is sent. */
export const NotATestCard: Story = {
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      await fillCard(root, '1234567890123456');
      await pay(root);
    }),
};

/** The Pay button spins and the fields lock while the gateway answers. */
export const Confirming: Story = {
  args: {
    confirm: mockConfirm(() => new Promise<FakeConfirmResult>(() => undefined)),
  },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      await fillCard(root, '4242424242424242');
      await pay(root);
    }),
};

/** S8: the card is declined, the guest is told why, and the form stays ready for another try. */
export const Declined: Story = {
  args: {
    confirm: gateway(() => ({
      status: 'declined',
      failureCode: 'card_declined',
    })),
  },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await fillCard(root, '4000000000000002');
      await pay(root);
      await canvas.findByText('Your card was declined');
    }),
};

/** The demo 3-D Secure step, where the guest chooses to pass or fail. */
export const Challenge: Story = {
  args: { confirm: challengeGateway() },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await fillCard(root, '4000000000003220');
      await pay(root);
      await canvas.findByRole('heading', { name: "Verify it's you" });
    }),
};

/** The guest failed 3-D Secure and is back at the card with the reason. */
export const ChallengeFailed: Story = {
  args: { confirm: challengeGateway() },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await fillCard(root, '4000000000003220');
      await pay(root);
      await userEvent.click(
        await canvas.findByRole('button', { name: 'Fail verification' }),
      );
      await canvas.findByText("We couldn't verify it's you");
    }),
};

/** The guest completed 3-D Secure and the payment went through. */
export const ChallengeCompleted: Story = {
  args: { confirm: challengeGateway() },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await fillCard(root, '4000000000003220');
      await pay(root);
      await userEvent.click(
        await canvas.findByRole('button', { name: 'Complete verification' }),
      );
      await canvas.findByText('Payment received');
    }),
};

/** The demo wallet sheet that opens from a wallet button. */
export const WalletSheet: Story = {
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await userEvent.click(canvas.getByRole('button', { name: 'Apple Pay' }));
      await canvas.findByRole('heading', { name: 'Apple Pay (demo)' });
    }),
};

/** The guest cancelled the wallet sheet: nothing was charged and nothing was sent. */
export const WalletCancelled: Story = {
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await userEvent.click(canvas.getByRole('button', { name: 'Google Pay' }));
      await userEvent.click(
        await canvas.findByRole('button', { name: 'Cancel' }),
      );
      await canvas.findByText('Google Pay was cancelled');
    }),
};

/** The payment went through. */
export const Paid: Story = {
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await fillCard(root, '4242424242424242');
      await pay(root);
      await canvas.findByText('Payment received');
    }),
};

/** S9: the answer never arrived; the guest is told to wait and cannot pay again. */
export const ConnectionLost: Story = {
  args: {
    confirm: mockConfirm(() => Promise.reject(new Error('Connection lost'))),
  },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await fillCard(root, '4242424242424242');
      await pay(root);
      await canvas.findByText("We're checking your payment");
    }),
};

/** The payment is no longer open, for example it already succeeded in another tab. */
export const NoLongerOpen: Story = {
  args: { confirm: gateway(() => ({ status: 'refused' })) },
  play: ({ canvasElement }) =>
    inEachScheme(canvasElement, async (root) => {
      const canvas = within(root);
      await fillCard(root, '4242424242424242');
      await pay(root);
      await canvas.findByText("We couldn't take this payment");
    }),
};
