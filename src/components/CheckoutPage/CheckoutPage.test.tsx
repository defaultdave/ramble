import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartPaymentResult } from '@/lib/checkout';
import type { ReholdResult } from '@/lib/pages/checkoutFlow';
import type { CheckoutView } from '@/lib/pages/checkoutPage';
import { CheckoutPage, type CheckoutActions } from './CheckoutPage';

// Behaviours under test:
// - loading, reloading, and re-rendering the page never calls `startPayment` (it spends one of the
//   hold's five tries per call), so five reloads leave payment possible
// - Continue checks the form first; a form with problems sends nothing and says which
// - a filled form sends one `startPayment`, once, and opens the payment form with its secret
// - each answer lands on its state: invalid (inline errors), expired, sold out with other dates, too many tries
// - paying goes to the confirmation with the order token
// - the maintenance switch shows the notice and no form

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const future = new Date(Date.now() + 10 * 60_000).toISOString();

const view: CheckoutView = {
  holdId: uuid(1),
  sessionId: uuid(2),
  experience: {
    id: uuid(3),
    slug: 'kayak',
    title: 'Sunset kayak on the Hudson',
    hostName: 'Hudson Paddle Club',
  },
  expiresAt: future,
  serverNow: new Date().toISOString(),
  holdMinutes: 10,
  startsAt: '2026-10-24T21:30:00.000Z',
  timeZone: 'America/New_York',
  dateLabel: 'Sat, Oct 24',
  timeLabel: '5:30 PM',
  guests: 2,
  where: 'Pier 26 boathouse, Tribeca.',
  lines: [{ label: '$65 × 2 guests', amountMinor: 13_000 }],
  taxTreatment: 'not_taxable',
  taxMinor: 0,
  totalMinor: 13_000,
  cancellationLine: 'Free cancellation until Fri, Oct 23, 5:30 PM.',
  ageSubject: { ageRule: 'minimum_age', minAge: 14, maxAge: null },
  children: 0,
  party: [{ priceOptionId: uuid(4), quantity: 2 }],
  termsDocument: { id: uuid(5), href: '/legal/terms' },
  waiverDocument: { id: uuid(6), href: '/legal/waiver-club' },
};

const secret = 'fake_pay_1_secret_0123456789abcdef';

const requiresPayment: StartPaymentResult = {
  status: 'requires_payment',
  orderId: 'o1',
  reference: 'RMB-ABC234',
  payment: { provider: 'fake', clientSecret: secret },
  amountDueMinor: 13_000,
  orderToken: 'order-token',
};

function actions(
  answer: () => Promise<StartPaymentResult> = () =>
    Promise.resolve(requiresPayment),
): CheckoutActions & { startPayment: ReturnType<typeof vi.fn> } {
  return {
    startPayment: vi.fn(answer),
    confirm: vi.fn(() => Promise.resolve({ status: 'succeeded' } as const)),
    reserve: vi.fn(() => Promise.reject(new Error('not used'))),
  };
}

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'alex@example.com');
  await user.type(screen.getByLabelText('Lead guest name'), 'Alex Rivera');
  await user.click(screen.getByLabelText(/Everyone is 14 or older/));
  await user.click(screen.getByLabelText(/I accept the waiver/));
  await user.click(screen.getByLabelText(/I accept Ramble's terms/));
}

describe('CheckoutPage', () => {
  it('never starts a payment by itself, so reloading spends no try', () => {
    const a = actions();
    for (let reload = 0; reload < 5; reload += 1) {
      const { unmount } = render(<CheckoutPage view={view} actions={a} />);
      unmount();
    }
    render(<CheckoutPage view={view} actions={a} />);
    expect(a.startPayment).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Continue to payment' }),
    ).toBeEnabled();
  });

  it('shows the hold, the summary, and an unticked newsletter', () => {
    render(<CheckoutPage view={view} actions={actions()} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Checkout' }),
    ).toBeVisible();
    expect(screen.getByRole('timer')).toHaveTextContent('Spaces held for');
    expect(
      screen.getByLabelText('Send me the Ramble newsletter'),
    ).not.toBeChecked();
    expect(
      screen.getByRole('link', { name: /Read the waiver/ }),
    ).toHaveAttribute('href', '/legal/waiver-club');
    expect(
      screen.getByRole('link', { name: /Read the terms/ }),
    ).toHaveAttribute('href', '/legal/terms');
  });

  it('sends nothing for an empty form and says what to fix', async () => {
    const a = actions();
    const user = userEvent.setup();
    render(<CheckoutPage view={view} actions={a} />);

    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' }),
    );

    expect(a.startPayment).not.toHaveBeenCalled();
    expect(screen.getByText('Check your details')).toBeVisible();
    expect(screen.getByText('Accept the terms to continue.')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveFocus();
    });
  });

  it('sends the filled form once and opens the payment form', async () => {
    const a = actions();
    const user = userEvent.setup();
    render(<CheckoutPage view={view} actions={a} />);

    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' }),
    );

    await screen.findByText('Demo payment form');
    expect(a.startPayment).toHaveBeenCalledTimes(1);
    expect(a.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: view.holdId,
        contact: { email: 'alex@example.com' },
        newsletterOptIn: false,
        termsDocumentId: view.termsDocument.id,
      }),
    );
  });

  it('goes to the confirmation with the order token once paid', async () => {
    const a = actions();
    const user = userEvent.setup();
    render(<CheckoutPage view={view} actions={a} />);
    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' }),
    );
    await screen.findByText('Demo payment form');

    await user.type(screen.getByLabelText('Card number'), '4242424242424242');
    await user.type(
      screen.getByLabelText('Expiry date, month and year'),
      '1299',
    );
    await user.type(screen.getByLabelText('Security code'), '123');
    await user.type(screen.getByLabelText('ZIP code'), '10001');
    await user.click(screen.getByRole('button', { name: 'Pay $130.00' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/orders/RMB-ABC234?t=order-token');
    });
    expect(a.confirm).toHaveBeenCalledWith({
      paymentId: 'fake_pay_1',
      clientSecret: secret,
      plan: { outcome: 'succeeded', method: 'card' },
    });
  });

  it('shows the server field errors under their fields', async () => {
    const a = actions(() =>
      Promise.resolve({
        status: 'invalid',
        fieldErrors: { 'contact.email': 'invalid' },
      }),
    );
    const user = userEvent.setup();
    render(<CheckoutPage view={view} actions={a} />);
    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' }),
    );

    expect(
      await screen.findByText('Enter an email address like alex@example.com.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      /Enter an email address/,
    );
  });

  it('keeps the form and says so when the request fails', async () => {
    const a = actions(() => Promise.reject(new Error('offline')));
    const user = userEvent.setup();
    render(<CheckoutPage view={view} actions={a} />);
    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' }),
    );

    expect(await screen.findByText(/couldn't reach Ramble/)).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveValue('alex@example.com');
  });

  it.each([
    [
      { status: 'hold_expired', canRehold: true, spacesLeft: 6 },
      'Your hold ended',
      'Hold my spaces again',
    ],
    [
      {
        status: 'sold_out',
        alternatives: [
          {
            sessionId: uuid(9),
            startsAt: '2026-10-25T21:30:00.000Z',
            timeZone: 'America/New_York',
            spacesLeft: 2,
          },
        ],
      },
      'These spaces are gone',
      'Sun, Oct 25 · 5:30 PM',
    ],
    [
      { status: 'too_many_tries' } as const,
      'Too many tries',
      'Back to the experience',
    ],
  ] as [StartPaymentResult, string, string][])(
    'lands on the state for %j',
    async (result, title, expected) => {
      const a = actions(() => Promise.resolve(result));
      const user = userEvent.setup();
      render(<CheckoutPage view={view} actions={a} />);
      await fill(user);
      await user.click(
        screen.getByRole('button', { name: 'Continue to payment' }),
      );

      expect(await screen.findByText(title)).toBeVisible();
      expect(screen.getByText(expected)).toBeVisible();
    },
  );

  it('moves focus to the payment panel, which has one Payment heading', async () => {
    const user = userEvent.setup();
    render(<CheckoutPage view={view} actions={actions()} />);
    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' }),
    );

    const panel = await screen.findByRole('group', { name: 'Payment' });
    await waitFor(() => {
      expect(panel).toHaveFocus();
    });
    expect(screen.getAllByRole('heading', { name: 'Payment' })).toHaveLength(1);
  });

  it.each([
    [{ status: 'too_many_tries' }, 'Too many tries'],
    [
      { status: 'hold_expired', canRehold: true, spacesLeft: 6 },
      'Your hold ended',
    ],
    [{ status: 'sold_out', alternatives: [] }, 'These spaces are gone'],
  ] as [StartPaymentResult, string][])(
    'moves focus to the panel for %j',
    async (result, title) => {
      const user = userEvent.setup();
      render(
        <CheckoutPage
          view={view}
          actions={actions(() => Promise.resolve(result))}
        />,
      );
      await fill(user);
      await user.click(
        screen.getByRole('button', { name: 'Continue to payment' }),
      );

      const panel = (await screen.findByText(title)).closest('[tabindex="-1"]');
      await waitFor(() => {
        expect(panel).toHaveFocus();
      });
    },
  );

  it('focuses the heading when the guest arrives from holding again', () => {
    render(<CheckoutPage view={view} actions={actions()} focusTitle />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Checkout' }),
    ).toHaveFocus();
  });

  it('leaves focus alone on a normal arrival', () => {
    render(<CheckoutPage view={view} actions={actions()} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Checkout' }),
    ).not.toHaveFocus();
  });

  it.each([
    [
      { status: 'blocked', reason: 'device_limit' },
      /most spaces one person can/,
    ],
    [
      { status: 'unavailable', reason: 'bookings_paused' },
      /Bookings are paused/,
    ],
    [
      { status: 'invalid', fieldErrors: {} },
      /couldn't hold those spaces again/,
    ],
  ] as [ReholdResult, RegExp][])(
    'after a refused re-hold (%j) offers the experience page, not another try',
    async (result, pattern) => {
      const a = actions();
      a.reserve = vi.fn(() => Promise.resolve(result));
      const user = userEvent.setup();
      render(
        <CheckoutPage
          view={{
            ...view,
            expiresAt: '2026-10-23T13:00:00.000Z',
            serverNow: '2026-10-23T14:00:00.000Z',
          }}
          actions={a}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'Hold my spaces again' }),
      );

      expect(await screen.findByText(pattern)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Hold my spaces again' }),
      ).toBeNull();
      expect(
        screen.getByRole('link', { name: 'Choose another date' }),
      ).toHaveAttribute('href', '/experiences/kayak-' + view.experience.id);
    },
  );

  it('lets the guest try again when the tries were spent before anything was released', async () => {
    const a = actions();
    a.reserve = vi.fn(() => Promise.resolve({ status: 'try_later' as const }));
    const user = userEvent.setup();
    render(
      <CheckoutPage
        view={{
          ...view,
          expiresAt: '2026-10-23T13:00:00.000Z',
          serverNow: '2026-10-23T14:00:00.000Z',
        }}
        actions={a}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Hold my spaces again' }),
    );

    expect(
      await screen.findByText(/Try again in a little while/),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Hold my spaces again' }),
    ).toBeEnabled();
  });

  it('focuses the first invalid field when the server finds a problem', async () => {
    const a = actions(() =>
      Promise.resolve({
        status: 'invalid',
        fieldErrors: { leadGuestName: 'invalid' },
      }),
    );
    const user = userEvent.setup();
    render(<CheckoutPage view={view} actions={a} />);
    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Lead guest name')).toHaveFocus();
    });
  });

  it('says that payment is being prepared while it waits', async () => {
    const user = userEvent.setup();
    render(
      <CheckoutPage
        view={view}
        actions={actions(
          () => new Promise<StartPaymentResult>(() => undefined),
        )}
      />,
    );
    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' }),
    );

    expect(
      (await screen.findAllByText('Getting your payment ready'))[0],
    ).toHaveAttribute('role', 'status');
  });

  it('shows the hold as ended when it had already lapsed on load', () => {
    render(
      <CheckoutPage
        view={{
          ...view,
          expiresAt: '2026-10-23T13:00:00.000Z',
          serverNow: '2026-10-23T14:00:00.000Z',
        }}
        actions={actions()}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('Hold expired');
    expect(screen.getByText('Your hold ended')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Hold my spaces again' }),
    ).toBeVisible();
  });

  it('holds again from the ended state and goes to the new checkout', async () => {
    const a = actions();
    a.reserve = vi.fn(() =>
      Promise.resolve({
        status: 'held' as const,
        holdId: uuid(77),
        expiresAt: future,
        totalMinor: 13_000,
        lines: [],
      }),
    );
    const user = userEvent.setup();
    render(
      <CheckoutPage
        view={{
          ...view,
          expiresAt: '2026-10-23T13:00:00.000Z',
          serverNow: '2026-10-23T14:00:00.000Z',
        }}
        actions={a}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Hold my spaces again' }),
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(`/checkout/${uuid(77)}?rehold=1`);
    });
    expect(a.reserve).toHaveBeenCalledWith({ holdId: view.holdId });
    expect(a.startPayment).not.toHaveBeenCalled();
  });

  it('asks for children ages and a guardian when children come', () => {
    render(
      <CheckoutPage
        view={{
          ...view,
          children: 2,
          ageSubject: { ageRule: 'all_ages', minAge: null, maxAge: null },
        }}
        actions={actions()}
      />,
    );
    expect(screen.getByLabelText('Child 1 age')).toBeVisible();
    expect(screen.getByLabelText('Child 2 age')).toBeVisible();
    expect(screen.getByLabelText('Guardian name')).toBeVisible();
    expect(screen.queryByLabelText(/Everyone is/)).toBeNull();
  });

  it('shows the maintenance notice and no form', () => {
    const a = actions();
    render(<CheckoutPage view={view} actions={a} maintenance />);
    expect(screen.getByText('Checkout is paused')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Continue to payment' }),
    ).toBeNull();
    expect(a.startPayment).not.toHaveBeenCalled();
  });
});
