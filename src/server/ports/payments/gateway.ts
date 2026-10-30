import 'server-only';
import { randomBytes } from 'node:crypto';
import { fakeGatewayLimits } from '@/lib/payments';
import {
  readFakeGatewayState,
  withFakeGatewayState,
} from '@/server/db/fakeGateway';
import { systemClock } from '@/server/ports/clock';
import type { PaymentsPort } from '.';
import {
  createFakePaymentsAdapter,
  createFakePaymentsState,
  type FakePaymentsAdapter,
  type FakePaymentsState,
} from './fake';

/**
 * The fake provider as the rest of the app sees it: the payments port, plus the simulation calls the
 * fake card form drives. Its objects live in the database, so any server instance finds a payment
 * another one created. There is no call that lists its events: `confirm` hands back the one it emitted.
 */
export type FakeGateway = Omit<FakePaymentsAdapter, 'emittedEvents'>;

function createGateway(webhookSecret: string): FakeGateway {
  const adapterOn = (state: FakePaymentsState) =>
    createFakePaymentsAdapter({
      webhookSecret,
      now: () => systemClock.now(),
      state,
      maxObjects: fakeGatewayLimits.maxObjects,
      maxEvents: fakeGatewayLimits.maxEvents,
    });

  // Signing and checking a delivery use the secret only, so they touch no database: a forged
  // delivery costs no query.
  const signer = adapterOn(createFakePaymentsState());
  const write = <T>(run: (adapter: FakePaymentsAdapter) => Promise<T>) =>
    withFakeGatewayState((state) => run(adapterOn(state)));
  const read = async <T>(run: (adapter: FakePaymentsAdapter) => Promise<T>) =>
    run(adapterOn(await readFakeGatewayState()));

  return {
    provider: signer.provider,
    createPayment: (input) => write((adapter) => adapter.createPayment(input)),
    cancelPayment: (input) => write((adapter) => adapter.cancelPayment(input)),
    refund: (input) => write((adapter) => adapter.refund(input)),
    transfer: (input) => write((adapter) => adapter.transfer(input)),
    reverseTransfer: (input) =>
      write((adapter) => adapter.reverseTransfer(input)),
    confirm: (paymentId, input) =>
      write((adapter) => adapter.confirm(paymentId, input)),
    retrieve: (query) => read((adapter) => adapter.retrieve(query)),
    getBalance: () => read((adapter) => adapter.getBalance()),
    verifyWebhook: (delivery) => signer.verifyWebhook(delivery),
    signWebhook: (event, signedAt) => signer.signWebhook(event, signedAt),
    signBody: (rawBody, signedAt) => signer.signBody(rawBody, signedAt),
  };
}

// Next can load this module once per route bundle in development. The gateway, and so the signing
// secret it closes over, lives on the global object so every copy signs and checks with the same one.
const sharedKey = Symbol.for('ramble.fakeGateway');

/**
 * The one fake gateway of this server process. Its objects are in the database; its webhook signing
 * secret is random per process, so a delivery nobody in this process signed is refused. The fake signs
 * and checks its own deliveries in one process (`deliverFakeConfirmation`), so no instance needs
 * another's secret. A payment's client secret is stored with it and keeps working across instances.
 */
export function getFakePayments(): FakeGateway {
  const found = Reflect.get(globalThis, sharedKey) as FakeGateway | undefined;
  if (found) return found;
  const created = createGateway(randomBytes(32).toString('hex'));
  Reflect.set(globalThis, sharedKey, created);
  return created;
}

/**
 * The payments port the webhook route and the event job go through. A stored event of another
 * provider than the port's is refused by the job, so the port needs no lookup by provider yet.
 */
// TODO(U-046): return the Stripe adapter when a Stripe key is configured.
export function getPaymentsPort(): PaymentsPort {
  return getFakePayments();
}
