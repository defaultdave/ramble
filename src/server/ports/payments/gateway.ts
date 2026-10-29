import 'server-only';
import { randomBytes } from 'node:crypto';
import { systemClock } from '@/server/ports/clock';
import type { PaymentsPort } from '.';
import {
  createFakePaymentsAdapter,
  createFakePaymentsState,
  type FakePaymentsAdapter,
  type FakePaymentsState,
} from './fake';

type Shared = { state: FakePaymentsState; webhookSecret: string };

// Next can load this module once per route bundle in development. The fake's objects and its
// signing secret live on the global object so every copy reads and signs the same ones.
const sharedKey = Symbol.for('ramble.fakePayments');

function shared(): Shared {
  const found = Reflect.get(globalThis, sharedKey) as Shared | undefined;
  if (found) return found;
  const created: Shared = {
    state: createFakePaymentsState(),
    webhookSecret: randomBytes(32).toString('hex'),
  };
  Reflect.set(globalThis, sharedKey, created);
  return created;
}

let adapter: FakePaymentsAdapter | undefined;

/**
 * The one fake gateway of this server process. Its objects live in memory and its webhook
 * signing secret is random per process, so a delivery nobody here signed is refused.
 */
export function getFakePayments(): FakePaymentsAdapter {
  const { state, webhookSecret } = shared();
  adapter ??= createFakePaymentsAdapter({
    webhookSecret,
    now: () => systemClock.now(),
    state,
  });
  return adapter;
}

/**
 * The payments port the webhook route and the event job go through. A stored event of another
 * provider than the port's is refused by the job, so the port needs no lookup by provider yet.
 */
// TODO(U-046): return the Stripe adapter when a Stripe key is configured.
export function getPaymentsPort(): PaymentsPort {
  return getFakePayments();
}
