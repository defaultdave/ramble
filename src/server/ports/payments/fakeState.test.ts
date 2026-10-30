import { describe, expect, it } from 'vitest';
import { createFakePaymentsAdapter, createFakePaymentsState } from './fake';
import { parseFakeState, serializeFakeState } from './fakeState';

// Behaviours under test:
// - a state that holds every kind of object, an idempotency record of each kind, action rounds, events, and a negative
//   balance survives a trip through JSON text with its dates as dates
// - an empty state does too
// - a row that is not exactly what the serializer writes is refused, never repaired

const now = new Date('2026-10-30T12:00:00.000Z');
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const metadata = (n: number) => ({ orderId: uuid(n), recordId: uuid(n + 100) });

/** A state every map of which holds something, built by the adapter itself so it is a state the fake can reach. */
async function busyState() {
  const state = createFakePaymentsState();
  const fake = createFakePaymentsAdapter({
    webhookSecret: 'whsec_fake_0123456789abcdef',
    now: () => now,
    state,
  });
  const paid = await fake.createPayment({
    idempotencyKey: 'pay:one:1',
    amountMinor: 14_950,
    currency: 'USD',
    metadata: metadata(1),
  });
  const challenged = await fake.createPayment({
    idempotencyKey: 'pay:two:1',
    amountMinor: 5_000,
    currency: 'USD',
    metadata: metadata(2),
  });
  const open = await fake.createPayment({
    idempotencyKey: 'pay:three:1',
    amountMinor: 5_000,
    currency: 'USD',
    metadata: metadata(3),
  });
  await fake.confirm(paid.id, { outcome: 'succeeded', method: 'apple_pay' });
  await fake.confirm(challenged.id, { outcome: 'requires_action' });
  await fake.confirm(challenged.id, {
    outcome: 'declined',
    failureCode: 'expired_card',
  });
  await fake.cancelPayment({
    idempotencyKey: 'cancel:three',
    paymentId: open.id,
  });
  const transfer = await fake.transfer({
    idempotencyKey: 'transfer:one',
    destinationAccountId: 'acct_fake_host',
    amountMinor: 1_000,
    currency: 'USD',
    metadata: metadata(1),
  });
  await fake.reverseTransfer({
    idempotencyKey: 'reversal:one',
    transferId: transfer.id,
    amountMinor: 100,
    metadata: metadata(1),
  });
  await fake.refund({
    idempotencyKey: 'refund:one',
    paymentId: paid.id,
    amountMinor: 14_000,
    metadata: metadata(1),
  });
  return state;
}

function first<T>(list: T[]): T {
  const [head] = list;
  if (head === undefined) throw new Error('Expected an entry');
  return head;
}

const roundTrip = (state: ReturnType<typeof createFakePaymentsState>) =>
  parseFakeState(JSON.parse(JSON.stringify(serializeFakeState(state))));

describe('serializeFakeState and parseFakeState', () => {
  it('brings back a busy state exactly, dates and all, through JSON text', async () => {
    const state = await busyState();

    const back = roundTrip(state);

    expect(back).toEqual(state);
    expect(back.events.every((event) => event.occurredAt instanceof Date)).toBe(
      true,
    );
    for (const map of [
      'payments',
      'refunds',
      'transfers',
      'reversals',
      'idempotency',
      'byMetadata',
      'actionRounds',
    ] as const) {
      expect(state[map].size, map).toBeGreaterThan(0);
    }
    expect(state.balanceMinor).toBeLessThan(0);
  });

  it('brings back an empty state', () => {
    expect(roundTrip(createFakePaymentsState())).toEqual(
      createFakePaymentsState(),
    );
  });

  it('writes plain JSON: entries for maps, text for dates', async () => {
    const stored = serializeFakeState(await busyState());

    expect(Array.isArray(stored.payments)).toBe(true);
    expect(typeof stored.events[0]?.occurredAt).toBe('string');
  });
});

describe('a row that is not what the serializer writes', () => {
  async function stored() {
    return JSON.parse(
      JSON.stringify(serializeFakeState(await busyState())),
    ) as Record<string, unknown> & {
      payments: [string, Record<string, unknown>][];
      events: Record<string, unknown>[];
    };
  }

  it.each([
    ['text', () => 'nope'],
    ['null', () => null],
    ['an array', () => []],
    ['an empty object', () => ({})],
    [
      'a map that is missing',
      (row: Awaited<ReturnType<typeof stored>>) => {
        Reflect.deleteProperty(row, 'refunds');
        return row;
      },
    ],
    [
      'a payment with a status the fake never uses',
      (row: Awaited<ReturnType<typeof stored>>) => {
        first(row.payments)[1].status = 'refunded';
        return row;
      },
    ],
    [
      'a payment in another currency',
      (row: Awaited<ReturnType<typeof stored>>) => {
        first(row.payments)[1].currency = 'EUR';
        return row;
      },
    ],
    [
      'a negative amount',
      (row: Awaited<ReturnType<typeof stored>>) => {
        first(row.payments)[1].amountMinor = -1;
        return row;
      },
    ],
    [
      'an event with a date that is not a date',
      (row: Awaited<ReturnType<typeof stored>>) => {
        first(row.events).occurredAt = 'yesterday';
        return row;
      },
    ],
    [
      'an event of a type Ramble does not know',
      (row: Awaited<ReturnType<typeof stored>>) => {
        first(row.events).type = 'charge.updated';
        return row;
      },
    ],
    [
      'a balance that is not a whole number',
      (row: Awaited<ReturnType<typeof stored>>) => {
        row.balanceMinor = 1.5;
        return row;
      },
    ],
    [
      'more events than the gateway ever holds',
      (row: Awaited<ReturnType<typeof stored>>) => {
        row.events = Array.from({ length: 10_001 }, () => first(row.events));
        return row;
      },
    ],
  ])('is refused when it holds %s', async (_name, damage) => {
    const row = await stored();
    expect(() => parseFakeState(damage(row as never))).toThrow();
  });
});
