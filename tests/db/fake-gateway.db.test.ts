import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { fakeGatewayLimits } from '@/lib/payments';
import {
  createFakePaymentsAdapter,
  createFakePaymentsState,
  type FakePaymentsState,
} from '@/server/ports/payments/fake';
import { serializeFakeState } from '@/server/ports/payments/fakeState';
import { setEnv } from '../email/testEnv';
import { createFreshDatabase, type FreshDatabase } from './harness';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));

// The fake payment gateway on its database row. Behaviours under test, one per decision, branch, or risk:
// - two gateways with different process secrets and no memory in common: a payment created on one is retrieved and
//   confirmed on the other, the balance carries over, and a delivery signed by one is refused by the other
// - the same idempotency key on the other gateway replays the first payment instead of making a second
// - two confirms of one payment at once give one success, one `invalid_state`, and one event
// - a call the fake refuses leaves the row byte for byte as it was, its time included
// - the caps refuse with `provider_unavailable`: objects, events, and the row's own byte limit holds a state at both
// - the row is locked while a write runs: a write that waited for the lock judges what the holder left (fails if
//   FOR UPDATE is removed)
// - the database refuses a second row, a document that is not an object, one past the byte limit, and a time out of range
// - a damaged row stops every call that reads it, and nothing is written over it

const processSecretKey = Symbol.for('ramble.fakeGatewaySecret');
const { maxObjects, maxEvents, stateStoredBytes } = fakeGatewayLimits;

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let dataModule: typeof import('@/server/db/fakeGateway');
let side: Pool;
const pools: (() => Promise<void>)[] = [];

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  setEnv(testEnv, { DATABASE_URL: fresh.url });
  client = await import('@/server/db/client');
  dataModule = await import('@/server/db/fakeGateway');
  side = new Pool({ connectionString: fresh.url, max: 4 });
});

afterAll(async () => {
  await side.end();
  await Promise.all(pools.map((end) => end()));
  await client.db.$client.end();
  await fresh.dispose();
});

beforeEach(async () => {
  await side.query('DELETE FROM fake_gateway_state');
});

/** A gateway of its own: a module copy loaded afresh, a new process secret, and nothing in memory. */
async function anotherProcess() {
  vi.resetModules();
  Reflect.deleteProperty(globalThis, processSecretKey);
  const copy = await import('@/server/ports/payments/gateway');
  const copyClient = await import('@/server/db/client');
  pools.push(() => copyClient.db.$client.end());
  return copy.getFakePayments();
}

const paymentInput = (key = randomUUID()) => ({
  idempotencyKey: `pay:${key}:1`,
  amountMinor: 13_000,
  currency: 'USD' as const,
  metadata: { orderId: randomUUID(), recordId: randomUUID() },
});

async function rowOf() {
  const { rows } = await side.query<{ text: string; updated_at: Date }>(
    'SELECT state::text AS text, updated_at FROM fake_gateway_state',
  );
  return rows;
}

async function storedState() {
  return dataModule.readFakeGatewayState();
}

async function putRow(state: FakePaymentsState) {
  await side.query(
    `INSERT INTO fake_gateway_state (key, state) VALUES ('fake', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET state = EXCLUDED.state`,
    [JSON.stringify(serializeFakeState(state))],
  );
}

/** A state built in memory by the adapter, so it is one the fake can reach, with no caps of its own to hit. */
function builder() {
  const state = createFakePaymentsState();
  const adapter = createFakePaymentsAdapter({
    webhookSecret: 'whsec_fake_0123456789abcdef',
    now: () => new Date(),
    state,
  });
  return { state, adapter };
}

/** Five events on each payment: three authentication challenges and two declines. */
async function payments(
  adapter: ReturnType<typeof builder>['adapter'],
  count: number,
  eventsEach: number,
) {
  for (let n = 0; n < count; n += 1) {
    const payment = await adapter.createPayment(paymentInput());
    for (let event = 0; event < eventsEach; event += 1) {
      await adapter.confirm(payment.id, {
        outcome: event < 3 ? 'requires_action' : 'declined',
      });
    }
  }
}

describe('across two server processes', () => {
  it('retrieves and confirms on one gateway a payment another made, and keeps the balance', async () => {
    const first = await anotherProcess();
    const created = await first.createPayment(paymentInput());

    const second = await anotherProcess();
    expect(second).not.toBe(first);
    await expect(
      second.retrieve({ kind: 'payment', id: created.id }),
    ).resolves.toEqual(created);
    const { payment, event } = await second.confirm(created.id, {
      outcome: 'succeeded',
    });

    expect(payment).toMatchObject({ status: 'succeeded', feeMinor: 407 });
    expect(event).toMatchObject({
      type: 'payment.succeeded',
      objectId: created.id,
    });
    const third = await anotherProcess();
    await expect(third.getBalance()).resolves.toEqual({
      availableMinor: 13_000 - 407,
      currency: 'USD',
    });
    expect((await storedState()).events).toHaveLength(1);
  });

  it('checks a delivery only against the secret of the process that signed it', async () => {
    const signer = await anotherProcess();
    const created = await signer.createPayment(paymentInput());
    const { event } = await signer.confirm(created.id, {
      outcome: 'succeeded',
    });
    const delivery = signer.signWebhook(event);

    await expect(signer.verifyWebhook(delivery)).resolves.toMatchObject({
      status: 'event',
    });
    await expect(
      (await anotherProcess()).verifyWebhook(delivery),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('replays the first payment for a repeated key instead of making a second', async () => {
    const input = paymentInput();
    const created = await (await anotherProcess()).createPayment(input);

    await expect(
      (await anotherProcess()).createPayment(input),
    ).resolves.toEqual(created);
    expect((await storedState()).payments.size).toBe(1);
  });

  it('finds nothing, and writes nothing, before the first payment', async () => {
    await expect(
      (await anotherProcess()).retrieve({ kind: 'payment', id: 'pay_none' }),
    ).resolves.toBeNull();
    expect(await rowOf()).toEqual([]);
  });

  it('makes its row on the first write', async () => {
    await (await anotherProcess()).createPayment(paymentInput());
    expect(await rowOf()).toHaveLength(1);
  });
});

describe('writes take turns', () => {
  it('lets one of two simultaneous confirms of a payment win, with one event', async () => {
    const fake = await anotherProcess();
    const created = await fake.createPayment(paymentInput());

    const results = await Promise.allSettled([
      fake.confirm(created.id, { outcome: 'succeeded' }),
      fake.confirm(created.id, { outcome: 'succeeded' }),
    ]);

    expect(results.map((result) => result.status).toSorted()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const lost = results.find((result) => result.status === 'rejected');
    expect(lost?.reason).toMatchObject({ code: 'invalid_state' });
    expect((await storedState()).events).toHaveLength(1);
  });

  it('judges a write that waited for the lock by what the holder left', async () => {
    const fake = await anotherProcess();
    const created = await fake.createPayment(paymentInput());
    const holder = await side.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM fake_gateway_state FOR UPDATE');

      let settled = false;
      const waiting = fake
        .confirm(created.id, { outcome: 'succeeded' })
        .finally(() => {
          settled = true;
        });
      const outcome = waiting.then(
        () => 'confirmed',
        (error: unknown) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);

      const state = await storedState();
      const held = state.payments.get(created.id);
      if (!held) throw new Error('payment missing');
      held.status = 'canceled';
      await holder.query(
        "UPDATE fake_gateway_state SET state = $1::jsonb WHERE key = 'fake'",
        [JSON.stringify(serializeFakeState(state))],
      );
      await holder.query('COMMIT');

      await expect(outcome).resolves.toMatchObject({ code: 'invalid_state' });
      expect((await storedState()).events).toHaveLength(0);
    } finally {
      holder.release();
    }
  });
});

describe('a refused call', () => {
  it('leaves the row byte for byte as it was', async () => {
    const fake = await anotherProcess();
    const created = await fake.createPayment(paymentInput());
    await fake.confirm(created.id, { outcome: 'succeeded' });
    const before = await rowOf();

    await expect(
      fake.confirm('pay_000000000000000000000000', { outcome: 'succeeded' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      fake.confirm(created.id, { outcome: 'declined' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(
      fake.refund({
        idempotencyKey: 'refund:too-much',
        paymentId: created.id,
        amountMinor: 13_001,
        metadata: created.metadata,
      }),
    ).rejects.toMatchObject({ code: 'refund_exceeds_captured' });

    expect(await rowOf()).toEqual(before);
  });
});

describe('the caps', () => {
  it('refuses a new object at the object cap and still settles the ones it holds', async () => {
    const { state, adapter } = builder();
    await payments(adapter, maxObjects, 0);
    await putRow(state);
    const before = await rowOf();
    const fake = await anotherProcess();

    await expect(fake.createPayment(paymentInput())).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    expect(await rowOf()).toEqual(before);
    const [first] = state.payments.keys();
    await expect(
      fake.confirm(first ?? '', { outcome: 'succeeded' }),
    ).resolves.toMatchObject({ payment: { status: 'succeeded' } });
  });

  it('refuses anything that would emit an event at the event cap, and still reads', async () => {
    const { state, adapter } = builder();
    // Payments that have used up their tries, then ones with tries left, to reach the cap exactly.
    await payments(adapter, 1_000, 8);
    await payments(adapter, (maxEvents - 8_000) / 5, 5);
    expect(state.events).toHaveLength(maxEvents);
    await putRow(state);
    const before = await rowOf();
    const fake = await anotherProcess();
    const open = [...state.payments.keys()].at(-1);

    await expect(fake.createPayment(paymentInput())).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    await expect(
      fake.confirm(open ?? '', { outcome: 'declined' }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(
      fake.retrieve({ kind: 'payment', id: open ?? '' }),
    ).resolves.toMatchObject({ id: open });
    expect(await rowOf()).toEqual(before);
  });

  it('stores a state holding both caps worth of objects and events inside the byte limit', async () => {
    const { state, adapter } = builder();
    await payments(adapter, maxObjects, maxEvents / maxObjects);
    expect(state.payments.size).toBe(maxObjects);
    expect(state.events).toHaveLength(maxEvents);

    await putRow(state);

    const { rows } = await side.query<{ bytes: number }>(
      'SELECT octet_length(state::text) AS bytes FROM fake_gateway_state',
    );
    const bytes = Number(rows[0]?.bytes);
    expect(bytes).toBeLessThan(stateStoredBytes * 0.9);
    await expect(
      (await anotherProcess()).retrieve({
        kind: 'payment',
        id: [...state.payments.keys()][0] ?? '',
      }),
    ).resolves.not.toBeNull();
  });
});

describe('the table', () => {
  const insert = (key: string, state: string) =>
    side.query(
      'INSERT INTO fake_gateway_state (key, state) VALUES ($1, $2::jsonb)',
      [key, state],
    );

  it('refuses a second row', async () => {
    await expect(insert('other', '{}')).rejects.toMatchObject({
      constraint: 'fake_gateway_state_single_row',
    });
  });

  it.each([
    ['an array', '[]'],
    ['text', '"x"'],
    ['null', 'null'],
  ])('refuses a document that is %s', async (_name, state) => {
    await expect(insert('fake', state)).rejects.toMatchObject({
      constraint: 'fake_gateway_state_document',
    });
  });

  it('refuses a document past the byte limit', async () => {
    await expect(
      side.query(
        `INSERT INTO fake_gateway_state (key, state)
         VALUES ('fake', jsonb_build_object('x', repeat('a', ${String(stateStoredBytes)})))`,
      ),
    ).rejects.toMatchObject({ constraint: 'fake_gateway_state_document' });
  });

  it('refuses a time outside the readable range', async () => {
    await expect(
      side.query(
        "INSERT INTO fake_gateway_state (key, state, updated_at) VALUES ('fake', '{}', '0500-01-01T00:00:00Z')",
      ),
    ).rejects.toMatchObject({
      constraint: 'fake_gateway_state_updated_at_in_range',
    });
  });
});

describe('a damaged row', () => {
  it('stops reads and writes alike, and is left as it was', async () => {
    await side.query(
      `INSERT INTO fake_gateway_state (key, state) VALUES ('fake', '{"payments": "not a list"}')`,
    );
    const before = await rowOf();
    const fake = await anotherProcess();

    await expect(
      fake.retrieve({ kind: 'payment', id: 'pay_x' }),
    ).rejects.toThrow();
    await expect(fake.getBalance()).rejects.toThrow();
    await expect(fake.createPayment(paymentInput())).rejects.toThrow();
    await expect(
      fake.confirm('pay_x', { outcome: 'succeeded' }),
    ).rejects.toThrow();

    expect(await rowOf()).toEqual(before);
  });
});
