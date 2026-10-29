import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FakeConfirmResult } from '@/lib/fakePayment';
import type { FakeConfirmInput } from '@/lib/fakePaymentInput';
import { FakePaymentForm } from './FakePaymentForm';

const payment = { id: 'pay_demo', clientSecret: 'pay_demo_secret_demo' };

function setup(
  answer: (input: FakeConfirmInput) => Promise<FakeConfirmResult>,
) {
  const confirm = vi.fn(answer);
  const onSucceeded = vi.fn();
  const onConnectionLost = vi.fn();
  const user = userEvent.setup();
  render(
    <FakePaymentForm
      payment={payment}
      amountMinor={13_000}
      confirm={confirm}
      onSucceeded={onSucceeded}
      onConnectionLost={onConnectionLost}
    />,
  );
  return { confirm, onSucceeded, onConnectionLost, user };
}

async function fillCard(
  user: ReturnType<typeof userEvent.setup>,
  number: string,
  expiry = '1299',
) {
  await user.type(screen.getByLabelText('Card number'), number);
  await user.type(screen.getByLabelText('Expiry date, month and year'), expiry);
  await user.type(screen.getByLabelText('Security code'), '123');
  await user.type(screen.getByLabelText('ZIP code'), '10001');
}

const ok = () => Promise.resolve({ status: 'succeeded' } as const);

describe('FakePaymentForm', () => {
  it('says it is a demo that takes no real card, and lists the test cards', () => {
    setup(ok);
    expect(screen.getByText('Demo payment form')).toBeVisible();
    expect(screen.getByText(/no real card is accepted/)).toBeVisible();
    expect(screen.getByText('4242 4242 4242 4242')).toBeInTheDocument();
  });

  it('labels every field and asks the browser to keep real cards out', () => {
    setup(ok);
    for (const name of [
      'Card number',
      'Expiry date, month and year',
      'Security code',
      'ZIP code',
    ]) {
      expect(screen.getByLabelText(name)).toHaveAttribute(
        'autocomplete',
        'off',
      );
    }
  });

  it('formats what is typed', async () => {
    const { user } = setup(ok);
    await user.type(screen.getByLabelText('Card number'), '4242424242424242');
    await user.type(
      screen.getByLabelText('Expiry date, month and year'),
      '1299',
    );
    expect(screen.getByLabelText('Card number')).toHaveValue(
      '4242 4242 4242 4242',
    );
    expect(screen.getByLabelText('Expiry date, month and year')).toHaveValue(
      '12 / 99',
    );
  });

  it('pays with a test card, sending the outcome and never the number', async () => {
    const { user, confirm, onSucceeded } = setup(ok);
    await fillCard(user, '4242424242424242');
    await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));
    await waitFor(() => {
      expect(onSucceeded).toHaveBeenCalledTimes(1);
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      paymentId: 'pay_demo',
      clientSecret: 'pay_demo_secret_demo',
      plan: { outcome: 'succeeded', method: 'card' },
    });
    expect(JSON.stringify(confirm.mock.calls)).not.toContain('4242');
    expect(screen.getByText('Payment received')).toBeVisible();
  });

  it('announces every field error, focuses the first, and sends nothing', async () => {
    const { user, confirm } = setup(ok);
    await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Enter a card number.')).toBeVisible();
    expect(within(alert).getByText('Enter the expiry date.')).toBeVisible();
    expect(screen.getByLabelText('Card number')).toHaveFocus();
    expect(screen.getByLabelText('Card number')).toBeInvalid();
    expect(screen.getByLabelText('Card number')).toHaveAccessibleDescription(
      'Enter a card number.',
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refuses a number that is not a test card without sending anything', async () => {
    const { user, confirm } = setup(ok);
    await fillCard(user, '1234567890123456');
    await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This demo takes only its test cards.',
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('clears a field error when the guest edits that field', async () => {
    const { user } = setup(ok);
    await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));
    await user.type(screen.getByLabelText('Security code'), '1');
    expect(screen.getByLabelText('Security code')).not.toBeInvalid();
  });

  it('tells the guest why a card was declined and lets them try again', async () => {
    const { user, confirm } = setup(() =>
      Promise.resolve({
        status: 'declined',
        failureCode: 'insufficient_funds',
      }),
    );
    await fillCard(user, '4000000000009995');
    await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));
    expect(
      await screen.findByText('Your card has insufficient funds'),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('still held');
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: { outcome: 'declined', failureCode: 'insufficient_funds' },
      }),
    );
    expect(screen.getByLabelText('Card number')).toHaveValue(
      '4000 0000 0000 9995',
    );
    expect(screen.getByRole('button', { name: 'Pay $130.00' })).toBeEnabled();
  });

  describe('3-D Secure', () => {
    async function toChallenge() {
      const answers: FakeConfirmResult[] = [{ status: 'requires_action' }];
      const setupResult = setup(() =>
        Promise.resolve(answers.shift() ?? { status: 'succeeded' }),
      );
      await fillCard(setupResult.user, '4000000000003220');
      await setupResult.user.click(
        screen.getByRole('button', { name: 'Pay $130.00' }),
      );
      await screen.findByRole('heading', { name: "Verify it's you" });
      return setupResult;
    }

    it('opens a labelled sheet and moves focus to it', async () => {
      const { confirm } = await toChallenge();
      expect(
        screen.getByRole('region', { name: "Verify it's you" }),
      ).toBeVisible();
      expect(
        screen.getByRole('heading', { name: "Verify it's you" }),
      ).toHaveFocus();
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ plan: { outcome: 'requires_action' } }),
      );
      expect(screen.queryByLabelText('Card number')).not.toBeInTheDocument();
    });

    it('pays when the guest completes it', async () => {
      const { user, confirm, onSucceeded } = await toChallenge();
      await user.click(
        screen.getByRole('button', { name: 'Complete verification' }),
      );
      await waitFor(() => {
        expect(onSucceeded).toHaveBeenCalledTimes(1);
      });
      expect(confirm).toHaveBeenLastCalledWith(
        expect.objectContaining({
          plan: { outcome: 'succeeded', method: 'card' },
        }),
      );
    });

    it('keeps focus off the page when the guest fails it: the notice takes it', async () => {
      const { user, confirm } = await toChallenge();
      confirm.mockResolvedValueOnce({
        status: 'declined',
        failureCode: 'authentication_failed',
      });
      const fail = screen.getByRole('button', { name: 'Fail verification' });
      await user.click(fail);
      await screen.findByText("We couldn't verify it's you");
      await waitFor(() => {
        expect(document.body).not.toHaveFocus();
      });
      expect(
        screen.getByText("We couldn't verify it's you").closest('[tabindex]'),
      ).toHaveFocus();
    });

    it('locks Fail verification with aria-disabled, not disabled, while sending', async () => {
      const { user, confirm } = await toChallenge();
      confirm.mockReturnValueOnce(new Promise(() => undefined));
      await user.click(
        screen.getByRole('button', { name: 'Fail verification' }),
      );
      const fail = screen.getByRole('button', { name: 'Fail verification' });
      expect(fail).toHaveAttribute('aria-disabled', 'true');
      expect(fail).toBeEnabled();
      expect(fail).toHaveFocus();
    });

    it('returns to the card with a message when the guest fails it', async () => {
      const { user, confirm } = await toChallenge();
      confirm.mockResolvedValueOnce({
        status: 'declined',
        failureCode: 'authentication_failed',
      });
      await user.click(
        screen.getByRole('button', { name: 'Fail verification' }),
      );
      expect(
        await screen.findByText("We couldn't verify it's you"),
      ).toBeVisible();
      expect(confirm).toHaveBeenLastCalledWith(
        expect.objectContaining({
          plan: { outcome: 'declined', failureCode: 'authentication_failed' },
        }),
      );
      expect(screen.getByLabelText('Card number')).toBeVisible();
    });
  });

  describe('wallets', () => {
    it.each([
      ['Apple Pay', 'apple_pay'],
      ['Google Pay', 'google_pay'],
    ] as const)(
      'pays with %s after the demo sheet is approved',
      async (label, method) => {
        const { user, confirm, onSucceeded } = setup(ok);
        await user.click(screen.getByRole('button', { name: label }));
        expect(
          screen.getByRole('heading', { name: `${label} (demo)` }),
        ).toHaveFocus();
        expect(confirm).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));
        await waitFor(() => {
          expect(onSucceeded).toHaveBeenCalledTimes(1);
        });
        expect(confirm).toHaveBeenCalledWith(
          expect.objectContaining({ plan: { outcome: 'succeeded', method } }),
        );
      },
    );

    it('charges nothing and says so when the sheet is cancelled', async () => {
      const { user, confirm } = setup(ok);
      await user.click(screen.getByRole('button', { name: 'Apple Pay' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByText('Apple Pay was cancelled')).toBeVisible();
      expect(screen.getByText(/Nothing was charged/)).toBeVisible();
      expect(confirm).not.toHaveBeenCalled();
      expect(
        screen.getByText('Apple Pay was cancelled').closest('[tabindex]'),
      ).toHaveFocus();
    });
  });

  it('announces the in-flight state', async () => {
    let release: (result: FakeConfirmResult) => void = () => undefined;
    const { user } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const announced = () =>
      screen
        .getAllByRole('status')
        .some((region) => region.textContent === 'Confirming payment');
    expect(announced()).toBe(false);
    await fillCard(user, '4242424242424242');
    await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));
    expect(announced()).toBe(true);
    release({ status: 'succeeded' });
  });

  it('locks the form while sending, so a double tap pays once', async () => {
    let release: (result: FakeConfirmResult) => void = () => undefined;
    const { user, confirm } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await fillCard(user, '4242424242424242');
    const pay = screen.getByRole('button', { name: 'Pay $130.00' });
    await user.dblClick(pay);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Pay $130.00' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Apple Pay' })).toBeDisabled();
    expect(screen.getByLabelText('Card number')).toBeDisabled();
    release({ status: 'succeeded' });
    expect(await screen.findByText('Payment received')).toBeVisible();
  });

  it('holds the form and says not to pay again when the answer is lost', async () => {
    const { user, onConnectionLost, onSucceeded } = setup(() =>
      Promise.reject(new Error('offline')),
    );
    await fillCard(user, '4242424242424242');
    await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));
    expect(
      await screen.findByText("We're checking your payment"),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent("don't pay again");
    expect(onConnectionLost).toHaveBeenCalledTimes(1);
    expect(onSucceeded).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Confirming payment' }),
    ).toBeDisabled();
    expect(screen.queryByLabelText('Card number')).not.toBeInTheDocument();
  });

  it('tells the guest when the payment is no longer open', async () => {
    const { user } = setup(() => Promise.resolve({ status: 'refused' }));
    await fillCard(user, '4242424242424242');
    await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));
    expect(
      await screen.findByText("We couldn't take this payment"),
    ).toBeVisible();
  });
});
