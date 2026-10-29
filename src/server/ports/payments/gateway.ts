import 'server-only';
import { randomBytes } from 'node:crypto';
import { systemClock } from '@/server/ports/clock';
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
