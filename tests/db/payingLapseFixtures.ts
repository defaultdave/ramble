import { eq, sql } from 'drizzle-orm';
import { holds } from '@/server/db/schema';
import type { Device } from '@/server/device';
import { createFakePaymentsAdapter } from '@/server/ports/payments/fake';
import {
  checkoutReaders,
  formFor,
  holdFor,
  proceeded,
  type Bookable,
  type CheckoutSuite,
} from './checkoutFixtures';

// Shared setup of the paying-hold lapse suites: a lapsed `paying` hold with an order, an attempt and the
// provider's payment, and readers over what the sweep leaves behind.
export function payingLapseFixtures(suite: () => CheckoutSuite) {
  const read = checkoutReaders(suite);

  const makePayments = () =>
    createFakePaymentsAdapter({
      webhookSecret: 'whsec_fake_lapse_0123456789abcdef',
      now: () => new Date(),
    });
  type Payments = ReturnType<typeof makePayments>;

  /** The hold's whole payment window is over: it expired 20 minutes ago and `paying_until` passed a minute ago. */
  const lapse = (holdId: string) =>
    suite()
      .client.db.update(holds)
      .set({
        createdAt: sql`now() - interval '30 minutes'`,
        updatedAt: sql`now() - interval '30 minutes'`,
        expiresAt: sql`now() - interval '20 minutes'`,
        payingUntil: sql`now() - interval '1 minute'`,
      })
      .where(eq(holds.id, holdId));

  /**
   * A booking hold of the device that started to pay, with the provider holding its payment, and
   * then lapsed. `storePayment: false` leaves the provider's payment unrecorded on the attempt (the
   * second transaction of `startPayment` failed); `createPayment: false` leaves none at the provider.
   */
  async function lapsedPayingHold(
    bookable: Bookable,
    payments: Payments,
    options: {
      device?: Device;
      adults?: number;
      storePayment?: boolean;
      createPayment?: boolean;
    } = {},
  ) {
    const device = options.device ?? suite().guestA;
    const hold = await holdFor(suite().client.db, bookable, device, {
      adults: options.adults ?? 2,
    });
    const started = proceeded(
      await suite().checkout.startPaymentTx(
        device,
        formFor(hold.id, suite().terms.id),
        'fake',
      ),
    );
    const payment =
      options.createPayment === false
        ? null
        : await payments.createPayment({
            idempotencyKey: started.attempt.providerKey,
            amountMinor: started.attempt.amountMinor,
            currency: 'USD',
            metadata: {
              orderId: started.order.id,
              recordId: started.attempt.id,
            },
          });
    if (payment && options.storePayment !== false) {
      await suite().checkout.recordProviderPayment(
        device,
        started.attempt.id,
        payment.id,
      );
    }
    await lapse(hold.id);
    return { hold, started, payment, device };
  }
  type Lapsed = Awaited<ReturnType<typeof lapsedPayingHold>>;

  async function state(lapsed: Lapsed) {
    const [attempt] = await read.attemptsOf(lapsed.started.order.id);
    return {
      hold: await read.storedHold(lapsed.hold.id),
      order: await read.orderOf(lapsed.hold.id),
      attempts: await read.attemptsOf(lapsed.started.order.id),
      attempt,
      provider: lapsed.payment
        ? ((await providerOf(lapsed.payment.id))?.status ?? null)
        : null,
    };
  }

  let providers: Payments | null = null;
  const providerOf = (id: string) =>
    providers?.retrieve({ kind: 'payment', id }) ?? Promise.resolve(null);
  const use = (payments: Payments) => {
    providers = payments;
    return payments;
  };

  const submit = (lapsed: Lapsed) =>
    suite().checkout.startPaymentTx(
      lapsed.device,
      formFor(lapsed.hold.id, suite().terms.id),
      'fake',
    );

  return { makePayments, lapse, lapsedPayingHold, state, use, submit, read };
}
