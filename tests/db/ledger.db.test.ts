import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  bookingPaid,
  cardFee,
  giftPurchased,
  rambleSelfPayout,
  refundRequested,
  refundSucceeded,
  transferPaid,
  type LedgerEntryInput,
} from '@/lib/ledger';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { createLedgerParents, type LedgerParents } from './ledgerParents';

// Behaviours under test, one per decision, branch or risk.
// The table and its CHECKs (each bad row is refused by the database, with the constraint named):
// - a cash row and a non-cash row are accepted; the defaults are USD and a recording time from clock_timestamp()
// - the debit and credit accounts differ; the amount is 1 to the cap; the currency is USD
// - an order, gift, or host is named, except on Ramble's own payout
// - a provider id is present exactly on rows that touch platform_cash, and is not blank or over 255 characters
// - a memo is not blank and at most 500 characters; times are in range
// - simulated has no default; the id is generated; an unknown entry type or account is refused
// - foreign keys to order, host, attempt, refund, and transfer; none on gift, dispute, or created_by; an order with entries cannot be deleted
// - the cash index: the same entry type and provider id twice is refused, the same id under another type is not, rows with no provider id repeat
// The append-only guard:
// - UPDATE, DELETE, and TRUNCATE are refused for the owner, and the rows stay
// - ledger_writer exists, cannot log in, has INSERT and SELECT only, can insert, and is refused update, delete, and truncate; the migration's role step can run twice
// postEntries:
// - posts an event and counts it; a repeated cash event posts nothing and says already_posted; a different id posts
// - a half-posted cash event throws and writes nothing, even when the caller catches the error
// - an invalid row, a mixed event, an empty event, and an oversized event write nothing
// - a non-cash event posts every time it is called (its caller's own row is what makes it once)
// - it joins the caller's transaction: a rollback leaves nothing; the recording time is taken after a wait inside the transaction
// - 12 parallel calls for one cash event post it once
// Reads:
// - cash balance, money held, finance export, and the host statement match what was posted
// - the window is half open on occurred_at; a host statement shows only that host
// - the host statement is for host owners of that host; a missing host, another host, ops, admin, a guest, and nobody get the same refusal
// - the export, money held, and cash balance are for ops and admin; host owners and guests are refused
// - an invalid window is refused

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let ledger: typeof import('@/server/db/ledger');
let parents: LedgerParents;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  stopHttp = await serveNeonHttp(fresh.url);
  client = await import('@/server/db/client');
  ledger = await import('@/server/db/ledger');
  parents = await createLedgerParents(client.db, 'ledger');
});

afterAll(async () => {
  await stopHttp();
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

type Row = Record<string, unknown>;

const constraint = (name: string) => ({ cause: { constraint: name } });
const code = (value: string) => ({ cause: { code: value } });
const notNull = code('23502');
const invalidText = code('22P02');
const foreignKey = code('23503');
const restricted = code('23001');
const noPrivilege = code('42501');

function valueOf(value: unknown) {
  return value === null ? sql.raw('NULL') : sql`${value}`;
}

function insert(row: Row) {
  const columns = Object.keys(row);
  return client.db.execute(
    sql`INSERT INTO ledger_entries (${sql.join(
      columns.map((column) => sql.identifier(column)),
      sql`, `,
    )}) VALUES (${sql.join(
      columns.map((column) => valueOf(row[column])),
      sql`, `,
    )})`,
  );
}

const occurred = '2026-11-02T15:00:00Z';
let counter = 0;
const nextProviderId = () => `pi_${String(++counter)}`;

/** A cash row at the column level: the host share of a payment. */
function cashRow(over: Row = {}): Row {
  return {
    occurred_at: occurred,
    entry_type: 'charge_host_share',
    debit_account: 'platform_cash',
    credit_account: 'host_payable',
    amount_minor: 11050,
    host_id: parents.hostId,
    provider_object_id: nextProviderId(),
    simulated: true,
    ...over,
  };
}

/** A non-cash row at the column level: a refund request leg. */
function plainRow(over: Row = {}): Row {
  return cashRow({
    entry_type: 'refund_host_share',
    debit_account: 'host_payable',
    credit_account: 'refunds_pending',
    provider_object_id: null,
    ...over,
  });
}

async function countRows(where = sql`TRUE`) {
  const { rows } = await client.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ledger_entries WHERE ${where}`,
  );
  return rows[0]?.n;
}

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];
const post = (rows: LedgerEntryInput[]) =>
  client.db.transaction((tx) => ledger.postEntries(tx, rows));
const postIn = (tx: Tx, rows: LedgerEntryInput[]) =>
  ledger.postEntries(tx, rows);

async function newBooking() {
  const orderId = await parents.newOrder();
  const paymentAttemptId = await parents.newAttempt(orderId);
  return { orderId, paymentAttemptId, hostId: parents.hostId };
}

const common = { occurredAt: new Date(occurred), simulated: true };
const worked = { ticketMinor: 13000, commissionMinor: 1950, taxMinor: 0 };

describe('ledger_entries', () => {
  it('accepts a cash row and a non-cash row, and fills the defaults', async () => {
    await insert(cashRow());
    await insert(plainRow());
    const { rows } = await client.db.execute<Row>(
      sql`SELECT currency, recorded_at > now() - interval '1 minute' AS recent, id FROM ledger_entries ORDER BY id LIMIT 1`,
    );
    expect(rows[0]).toMatchObject({ currency: 'USD', recent: true });
    expect(Number(rows[0]?.id)).toBeGreaterThan(0);
  });

  it.each([
    [
      'the same debit and credit account',
      () => plainRow({ credit_account: 'host_payable' }),
      'ledger_entries_accounts_differ',
    ],
    [
      'an amount of zero',
      () => cashRow({ amount_minor: 0 }),
      'ledger_entries_amount_in_range',
    ],
    [
      'an amount below zero',
      () => cashRow({ amount_minor: -1 }),
      'ledger_entries_amount_in_range',
    ],
    [
      'an amount over the cap',
      () => cashRow({ amount_minor: 2_000_000_001 }),
      'ledger_entries_amount_in_range',
    ],
    [
      'a currency other than USD',
      () => cashRow({ currency: 'EUR' }),
      'ledger_entries_currency_usd',
    ],
    [
      'no order, gift, or host',
      () => cashRow({ host_id: null }),
      'ledger_entries_names_a_subject',
    ],
    [
      'a cash row with no provider id',
      () => cashRow({ provider_object_id: null }),
      'ledger_entries_provider_id_on_cash',
    ],
    [
      'a cash row on the credit side with no provider id',
      () =>
        cashRow({
          entry_type: 'transfer_to_host',
          debit_account: 'host_payable',
          credit_account: 'platform_cash',
          provider_object_id: null,
        }),
      'ledger_entries_provider_id_on_cash',
    ],
    [
      'a non-cash row with a provider id',
      () => plainRow({ provider_object_id: 'pi_x' }),
      'ledger_entries_provider_id_on_cash',
    ],
    [
      'a blank provider id',
      () => cashRow({ provider_object_id: '  ' }),
      'ledger_entries_provider_id_text',
    ],
    [
      'a provider id over 255 characters',
      () => cashRow({ provider_object_id: 'p'.repeat(256) }),
      'ledger_entries_provider_id_text',
    ],
    ['a blank memo', () => cashRow({ memo: ' ' }), 'ledger_entries_memo_text'],
    [
      'a memo over 500 characters',
      () => cashRow({ memo: 'm'.repeat(501) }),
      'ledger_entries_memo_text',
    ],
    [
      'an occurrence before year 1000',
      () => cashRow({ occurred_at: '0999-12-31T00:00:00Z' }),
      'ledger_entries_occurred_at_in_range',
    ],
    [
      'a recording time in year 10000',
      () => cashRow({ recorded_at: '10000-01-01 00:00:00+00' }),
      'ledger_entries_recorded_at_in_range',
    ],
  ])('refuses %s', async (_name, row, name) => {
    await expect(insert(row())).rejects.toMatchObject(constraint(name));
  });

  it('accepts the bounds: an amount of 1 and of the cap, 255 and 500 characters', async () => {
    await insert(cashRow({ amount_minor: 1 }));
    await insert(cashRow({ amount_minor: 2_000_000_000 }));
    await insert(
      cashRow({
        provider_object_id: 'p'.repeat(255),
        memo: 'm'.repeat(500),
      }),
    );
  });

  it("lets Ramble's own payout name no order, gift, or host, and no other type", async () => {
    const payout = {
      entry_type: 'ramble_payout',
      debit_account: 'ramble_payouts',
      credit_account: 'platform_cash',
      host_id: null,
    };
    await insert(cashRow(payout));
    await expect(
      insert(cashRow({ ...payout, entry_type: 'processing_fee' })),
    ).rejects.toMatchObject(constraint('ledger_entries_names_a_subject'));
  });

  it('accepts a gift or an order alone as the subject, with no foreign key on the gift', async () => {
    await insert(cashRow({ host_id: null, gift_id: randomUUID() }));
    await insert(
      cashRow({ host_id: null, order_id: await parents.newOrder() }),
    );
  });

  it('has no default for simulated and generates the id itself', async () => {
    const withoutSimulated = Object.fromEntries(
      Object.entries(cashRow()).filter(([column]) => column !== 'simulated'),
    );
    await expect(insert(withoutSimulated)).rejects.toMatchObject(notNull);
    await expect(insert(cashRow({ id: 5 }))).rejects.toMatchObject(
      code('428C9'),
    );
  });

  it.each([
    ['an unknown entry type', { entry_type: 'bonus' }],
    ['an unknown debit account', { debit_account: 'petty_cash' }],
    ['an unknown credit account', { credit_account: 'petty_cash' }],
  ])('refuses %s', async (_name, over) => {
    await expect(insert(cashRow(over))).rejects.toMatchObject(invalidText);
  });

  it.each([
    ['order_id', { order_id: randomUUID() }],
    ['host_id', { host_id: randomUUID() }],
    ['payment_attempt_id', { payment_attempt_id: randomUUID() }],
    ['refund_id', { refund_id: randomUUID() }],
    ['transfer_id', { transfer_id: randomUUID() }],
  ])('refuses a %s that points at nothing', async (_name, over) => {
    await expect(insert(cashRow(over))).rejects.toMatchObject(foreignKey);
  });

  it('takes a dispute and a staff user with no row behind them yet', async () => {
    await insert(
      cashRow({ dispute_id: randomUUID(), created_by: randomUUID() }),
    );
  });

  it('keeps an order that has entries from being deleted', async () => {
    const { orderId } = await newBooking();
    await insert(cashRow({ order_id: orderId }));
    await expect(
      client.db.execute(sql`DELETE FROM orders WHERE id = ${orderId}`),
    ).rejects.toMatchObject(foreignKey);
  });

  it('keeps cash from posting twice: one entry type and provider id, once', async () => {
    const providerId = nextProviderId();
    await insert(cashRow({ provider_object_id: providerId }));
    await expect(
      insert(cashRow({ provider_object_id: providerId })),
    ).rejects.toMatchObject(constraint('ledger_entries_cash_event_unique'));
    // The same provider id under another type is another posting of the same payment.
    await insert(
      cashRow({
        entry_type: 'charge_commission',
        credit_account: 'ramble_commission',
        provider_object_id: providerId,
      }),
    );
  });

  it('lets rows with no provider id repeat, and the index only covers rows with one', async () => {
    await insert(plainRow());
    await insert(plainRow());
    const { rows } = await client.db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE schemaname = ${fresh.schema} AND indexname = 'ledger_entries_cash_event_unique'`,
    );
    expect(rows[0]?.indexdef).toMatch(
      /UNIQUE.*\(entry_type, provider_object_id\)/,
    );
    expect(rows[0]?.indexdef).toMatch(/WHERE.*provider_object_id IS NOT NULL/);
  });
});

describe('the append-only guard', () => {
  async function seeded() {
    const providerId = nextProviderId();
    await insert(cashRow({ provider_object_id: providerId }));
    return providerId;
  }

  it('refuses an update, even by the table owner, and the row stays as it was', async () => {
    const providerId = await seeded();
    await expect(
      client.db.execute(
        sql`UPDATE ledger_entries SET amount_minor = 1 WHERE provider_object_id = ${providerId}`,
      ),
    ).rejects.toMatchObject(restricted);
    expect(
      await countRows(
        sql`provider_object_id = ${providerId} AND amount_minor = 11050`,
      ),
    ).toBe(1);
  });

  it('refuses a delete, even by the table owner, and the row stays', async () => {
    const providerId = await seeded();
    await expect(
      client.db.execute(
        sql`DELETE FROM ledger_entries WHERE provider_object_id = ${providerId}`,
      ),
    ).rejects.toMatchObject(restricted);
    expect(await countRows(sql`provider_object_id = ${providerId}`)).toBe(1);
  });

  it('refuses a truncate, with or without cascade', async () => {
    await seeded();
    const before = await countRows();
    await expect(
      client.db.execute(sql`TRUNCATE ledger_entries`),
    ).rejects.toMatchObject(restricted);
    await expect(
      client.db.execute(sql`TRUNCATE ledger_entries CASCADE`),
    ).rejects.toMatchObject(restricted);
    expect(await countRows()).toBe(before);
  });

  it('has a ledger_writer role that cannot log in and holds INSERT and SELECT only', async () => {
    const { rows: roles } = await client.db.execute<{ rolcanlogin: boolean }>(
      sql`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'ledger_writer'`,
    );
    expect(roles).toEqual([{ rolcanlogin: false }]);
    const { rows: grants } = await client.db.execute<{
      privilege_type: string;
    }>(
      sql`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'ledger_writer' AND table_schema = ${fresh.schema} AND table_name = 'ledger_entries' ORDER BY privilege_type`,
    );
    expect(grants.map((grant) => grant.privilege_type)).toEqual([
      'INSERT',
      'SELECT',
    ]);
  });

  it('lets ledger_writer insert and read, and refuses it update, delete, and truncate', async () => {
    await client.db.execute(
      sql.raw(`GRANT USAGE ON SCHEMA ${fresh.schema} TO ledger_writer`),
    );
    const asWriter = async (statement: ReturnType<typeof sql>) =>
      client.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE ledger_writer`);
        await tx.execute(statement);
      });
    await asWriter(sql`SELECT count(*) FROM ledger_entries`);
    const providerId = nextProviderId();
    await client.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE ledger_writer`);
      await tx.execute(
        sql`INSERT INTO ledger_entries (occurred_at, entry_type, debit_account, credit_account, amount_minor, host_id, provider_object_id, simulated) VALUES (${occurred}, 'charge_host_share', 'platform_cash', 'host_payable', 5, ${parents.hostId}, ${providerId}, true)`,
      );
    });
    expect(await countRows(sql`provider_object_id = ${providerId}`)).toBe(1);
    await expect(
      asWriter(sql`UPDATE ledger_entries SET amount_minor = 1`),
    ).rejects.toMatchObject(noPrivilege);
    await expect(
      asWriter(sql`DELETE FROM ledger_entries`),
    ).rejects.toMatchObject(noPrivilege);
    await expect(asWriter(sql`TRUNCATE ledger_entries`)).rejects.toMatchObject(
      noPrivilege,
    );
  });

  it('can create the role a second time without failing, as a second schema or branch would', async () => {
    const step = sql`DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledger_writer') THEN
          CREATE ROLE ledger_writer NOLOGIN;
        END IF;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL;
      END
      $$`;
    await client.db.execute(step);
    await client.db.execute(step);
    const { rows } = await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'ledger_writer'`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('postEntries', () => {
  it('posts an event, counts its rows, and fills the recorded fields', async () => {
    const booking = await newBooking();
    const rows = bookingPaid({
      ...common,
      ...booking,
      providerObjectId: nextProviderId(),
      split: { ...worked, taxMinor: 100 },
    });
    expect(await post(rows)).toEqual({ status: 'posted', count: 3 });
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(3);
    const { rows: stored } = await client.db.execute<Row>(
      sql`SELECT entry_type, amount_minor, currency, simulated, host_id, payment_attempt_id FROM ledger_entries WHERE order_id = ${booking.orderId} ORDER BY id`,
    );
    expect(stored.map((row) => [row.entry_type, row.amount_minor])).toEqual([
      ['charge_host_share', 11050],
      ['charge_commission', 1950],
      ['charge_tax', 100],
    ]);
    expect(stored[0]).toMatchObject({
      currency: 'USD',
      simulated: true,
      host_id: booking.hostId,
      payment_attempt_id: booking.paymentAttemptId,
    });
  });

  it('posts a repeated cash event once and says so the second time', async () => {
    const booking = await newBooking();
    const rows = bookingPaid({
      ...common,
      ...booking,
      providerObjectId: nextProviderId(),
      split: worked,
    });
    expect(await post(rows)).toMatchObject({ status: 'posted' });
    expect(await post(rows)).toEqual({ status: 'already_posted' });
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(2);
  });

  it('posts another provider id for the same booking as a new event', async () => {
    const booking = await newBooking();
    const fee = (providerObjectId: string) =>
      cardFee({ ...common, ...booking, providerObjectId, amountMinor: 407 });
    expect(await post(fee(nextProviderId()))).toMatchObject({
      status: 'posted',
    });
    expect(await post(fee(nextProviderId()))).toMatchObject({
      status: 'posted',
    });
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(2);
  });

  it('throws on a half-posted cash event and writes nothing, even when the caller catches it', async () => {
    const booking = await newBooking();
    const providerObjectId = nextProviderId();
    await post(
      bookingPaid({
        ...common,
        ...booking,
        providerObjectId,
        split: worked,
      }).slice(0, 1),
    );
    const full = bookingPaid({
      ...common,
      ...booking,
      providerObjectId,
      split: { ...worked, taxMinor: 100 },
    });
    await client.db.transaction(async (tx) => {
      await expect(postIn(tx, full)).rejects.toThrow(/Half-posted/);
      // The caller's transaction is still usable, and the savepoint kept the new rows out.
      expect(await postIn(tx, plainEvent(booking))).toMatchObject({
        status: 'posted',
      });
    });
    expect(
      await countRows(
        sql`order_id = ${booking.orderId} AND provider_object_id IS NOT NULL`,
      ),
    ).toBe(1);
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(2);
  });

  function plainEvent(booking: { orderId: string; hostId: string }) {
    return refundRequested({
      ...common,
      orderId: booking.orderId,
      hostId: booking.hostId,
      refundId: randomUUID().replace(/^./, 'a'),
      split: { ticketMinor: 500, commissionMinor: 0, taxMinor: 0 },
    }).map((row) => ({ ...row, refundId: null }));
  }

  it('writes nothing for an invalid row, a mixed event, an empty event, or an oversized one', async () => {
    const booking = await newBooking();
    const good = bookingPaid({
      ...common,
      ...booking,
      providerObjectId: nextProviderId(),
      split: worked,
    });
    const cashOne = good[0] as LedgerEntryInput;
    const mixed = [cashOne, ...plainEvent(booking)];
    const oversized = Array.from(
      { length: 4 },
      () => plainEvent(booking)[0] as LedgerEntryInput,
    );
    await expect(
      post([
        good[0] as LedgerEntryInput,
        { ...(good[1] as LedgerEntryInput), amountMinor: 0 },
      ]),
    ).rejects.toThrow();
    await expect(post(mixed)).rejects.toThrow();
    await expect(post([])).rejects.toThrow();
    await expect(post(oversized)).rejects.toThrow(RangeError);
    await expect(
      post([{ ...cashOne, providerObjectId: null }]),
    ).rejects.toThrow();
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(0);
  });

  it('posts a non-cash event every time it is called', async () => {
    const booking = await newBooking();
    const rows = plainEvent(booking);
    await post(rows);
    await post(rows);
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(2);
  });

  it('joins the caller transaction, so a rollback leaves nothing', async () => {
    const booking = await newBooking();
    await expect(
      client.db.transaction(async (tx) => {
        await postIn(
          tx,
          bookingPaid({
            ...common,
            ...booking,
            providerObjectId: nextProviderId(),
            split: worked,
          }),
        );
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(0);
  });

  it('takes the recording time from clock_timestamp() after a wait inside the transaction', async () => {
    const booking = await newBooking();
    await client.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_sleep(0.05)`);
      await postIn(
        tx,
        cardFee({
          ...common,
          ...booking,
          providerObjectId: nextProviderId(),
          amountMinor: 407,
        }),
      );
      const { rows } = await tx.execute<{ later: boolean }>(
        sql`SELECT recorded_at > transaction_timestamp() AS later FROM ledger_entries WHERE order_id = ${booking.orderId}`,
      );
      expect(rows[0]?.later).toBe(true);
    });
  });

  it('posts a cash event once when 12 calls race', async () => {
    const booking = await newBooking();
    const rows = bookingPaid({
      ...common,
      ...booking,
      providerObjectId: nextProviderId(),
      split: { ...worked, taxMinor: 100 },
    });
    const answers = await Promise.all(
      Array.from({ length: 12 }, () => post(rows)),
    );
    expect(answers.filter((answer) => answer.status === 'posted')).toHaveLength(
      1,
    );
    expect(
      answers.filter((answer) => answer.status === 'already_posted'),
    ).toHaveLength(11);
    expect(await countRows(sql`order_id = ${booking.orderId}`)).toBe(3);
  });
});

describe('the views', () => {
  const from = new Date('2026-12-01T00:00:00Z');
  const to = new Date('2026-12-08T00:00:00Z');
  const inside = new Date('2026-12-03T15:00:00Z');
  const outside = new Date('2026-12-08T00:00:00Z');
  const ops = testCaller({ roles: [Role.Ops] });
  const admin = testCaller({ roles: [Role.Admin] });

  // Another host's booking, to prove a statement shows only its own host.
  let otherHostId: string;
  let booking: Awaited<ReturnType<typeof newBooking>>;
  let baseline: { cash: number; held: number };

  beforeAll(async () => {
    const other = await createLedgerParents(client.db, 'ledger-other');
    otherHostId = other.hostId;
    booking = await newBooking();
    baseline = {
      cash: await ledger.readCashBalance(ops),
      held: (await ledger.readMoneyHeld(ops)).moneyHeldMinor,
    };
    const when = { occurredAt: inside, simulated: true };
    await post(
      bookingPaid({
        ...when,
        ...booking,
        providerObjectId: nextProviderId(),
        split: worked,
      }),
    );
    await post(
      cardFee({
        ...when,
        ...booking,
        providerObjectId: nextProviderId(),
        amountMinor: 407,
      }),
    );
    const transferId = await parents.newTransfer(booking.orderId);
    await post(
      transferPaid({
        ...when,
        orderId: booking.orderId,
        hostId: booking.hostId,
        transferId,
        providerObjectId: nextProviderId(),
        amountMinor: 1000,
      }),
    );
    const refund = await parents.newRefund(
      booking.orderId,
      booking.paymentAttemptId,
    );
    const refundLinks = {
      ...when,
      orderId: booking.orderId,
      hostId: booking.hostId,
      refundId: refund,
    };
    await post(
      refundRequested({
        ...refundLinks,
        split: { ticketMinor: 6500, commissionMinor: 975, taxMinor: 0 },
      }),
    );
    // A booking on another host, inside the window, and a row of this booking outside it.
    const stranger = await parents.newOrder();
    const strangerAttempt = await parents.newAttempt(stranger);
    await post(
      bookingPaid({
        ...when,
        orderId: stranger,
        hostId: otherHostId,
        paymentAttemptId: strangerAttempt,
        providerObjectId: nextProviderId(),
        split: worked,
      }),
    );
    await post(
      cardFee({
        occurredAt: outside,
        simulated: false,
        ...booking,
        providerObjectId: nextProviderId(),
        amountMinor: 999,
      }),
    );
    await post(
      rambleSelfPayout({
        ...when,
        providerObjectId: nextProviderId(),
        amountMinor: 700,
      }),
    );
    await post(
      giftPurchased({
        ...when,
        giftId: randomUUID(),
        providerObjectId: nextProviderId(),
        amountMinor: 5000,
      }),
    );
  });

  it('give the cash balance and the money held from every posting', async () => {
    // booking: +13000 -407 -1000 (transfer); stranger: +13000; fee outside: -999; payout: -700; gift: +5000
    expect((await ledger.readCashBalance(ops)) - baseline.cash).toBe(
      13000 - 407 - 1000 + 13000 - 999 - 700 + 5000,
    );
    const held = await ledger.readMoneyHeld(ops);
    // host_payable: 11050 - 1000 - 5525 + 11050 (stranger); refunds_pending 6500; gift_liability 5000
    expect(held.moneyHeldMinor - baseline.held).toBe(
      11050 - 1000 - 5525 + 11050 + 6500 + 5000,
    );
    expect(held.moneyHeldMinor).toBe(
      held.balances.host_payable +
        held.balances.gift_liability +
        held.balances.refunds_pending,
    );
  });

  it('exports one row per booking in the half-open window, marking simulated money', async () => {
    const rows = await ledger.readFinanceExport(ops, { from, to });
    const mine = rows.find((row) => row.orderId === booking.orderId);
    expect(rows.filter((row) => row.orderId === booking.orderId)).toHaveLength(
      1,
    );
    expect(mine).toEqual({
      orderId: booking.orderId,
      hostId: booking.hostId,
      grossMinor: 13000,
      taxMinor: 0,
      commissionMinor: 1950,
      processingFeeMinor: 407,
      refundedMinor: 6500,
      paidToHostMinor: 1000,
      owedToHostMinor: 11050 - 1000 - 5525,
      simulated: true,
      firstAt: inside,
      paidAt: inside,
    });
    expect(rows.some((row) => row.hostId === otherHostId)).toBe(true);
  });

  it('leaves out rows at the end of the window and takes rows at its start', async () => {
    const atEnd = await ledger.readFinanceExport(ops, {
      from: inside,
      to: outside,
    });
    expect(
      atEnd.find((row) => row.orderId === booking.orderId)?.processingFeeMinor,
    ).toBe(407);
    const exactlyAtStart = await ledger.readFinanceExport(ops, {
      from: outside,
      to: new Date('2026-12-09T00:00:00Z'),
    });
    expect(
      exactlyAtStart.find((row) => row.orderId === booking.orderId),
    ).toMatchObject({ processingFeeMinor: 999, simulated: false });
  });

  it("shows a host its own bookings and totals, and not another host's", async () => {
    const owner = testCaller({
      roles: [Role.HostOwner],
      hostIds: [booking.hostId],
    });
    const statement = await ledger.readHostStatement(owner, booking.hostId, {
      from,
      to,
    });
    expect(statement.rows.map((row) => row.orderId)).toEqual([booking.orderId]);
    expect(statement.totals).toMatchObject({
      grossMinor: 13000,
      commissionMinor: 1950,
      paidToHostMinor: 1000,
    });
  });

  it('refuses a host statement with the same error for a missing host, another host, ops, admin, a guest, and nobody', async () => {
    const owner = testCaller({
      roles: [Role.HostOwner],
      hostIds: [booking.hostId],
    });
    const attempts = [
      ledger.readHostStatement(owner, randomUUID(), { from, to }),
      ledger.readHostStatement(owner, otherHostId, { from, to }),
      ledger.readHostStatement(ops, booking.hostId, { from, to }),
      ledger.readHostStatement(admin, booking.hostId, { from, to }),
      ledger.readHostStatement(testCaller(), booking.hostId, { from, to }),
      ledger.readHostStatement(
        { userId: null, roles: [], hostIds: [] },
        booking.hostId,
        { from, to },
      ),
    ];
    const results = await Promise.allSettled(attempts);
    const reasons = results.map((result) =>
      result.status === 'rejected' ? (result.reason as Error) : null,
    );
    for (const reason of reasons) {
      expect(reason).toBeInstanceOf(ForbiddenError);
    }
    expect(
      new Set(
        reasons.map((reason) => [reason?.name, reason?.message].join('|')),
      ).size,
    ).toBe(1);
  });

  it.each([
    [
      'a host owner',
      testCaller({ roles: [Role.HostOwner], hostIds: [randomUUID()] }),
    ],
    ['a guest', testCaller()],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])(
    'refuses the export, money held, and cash balance to %s',
    async (_name, caller) => {
      await expect(
        ledger.readFinanceExport(caller, { from, to }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(ledger.readMoneyHeld(caller)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(ledger.readCashBalance(caller)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    },
  );

  it('lets admin read the staff views', async () => {
    await expect(
      ledger.readFinanceExport(admin, { from, to }),
    ).resolves.toBeDefined();
    await expect(ledger.readMoneyHeld(admin)).resolves.toBeDefined();
    await expect(ledger.readCashBalance(admin)).resolves.toBeTypeOf('number');
  });

  it('refuses a window that does not start before it ends, after checking who is asking', async () => {
    await expect(
      ledger.readFinanceExport(ops, { from: to, to: from }),
    ).rejects.toThrow();
    const owner = testCaller({
      roles: [Role.HostOwner],
      hostIds: [booking.hostId],
    });
    await expect(
      ledger.readHostStatement(owner, booking.hostId, { from: to, to: from }),
    ).rejects.toThrow();
  });

  it('keeps the money-held figure tied to a refund that then succeeded', async () => {
    const before = (await ledger.readMoneyHeld(ops)).balances.refunds_pending;
    const refund = await parents.newRefund(
      booking.orderId,
      booking.paymentAttemptId,
    );
    const links = {
      ...common,
      orderId: booking.orderId,
      hostId: booking.hostId,
      refundId: refund,
    };
    await post(
      refundRequested({
        ...links,
        split: { ticketMinor: 100, commissionMinor: 0, taxMinor: 0 },
      }),
    );
    expect((await ledger.readMoneyHeld(ops)).balances.refunds_pending).toBe(
      before + 100,
    );
    await post(
      refundSucceeded({
        ...links,
        providerObjectId: nextProviderId(),
        amountMinor: 100,
      }),
    );
    expect((await ledger.readMoneyHeld(ops)).balances.refunds_pending).toBe(
      before,
    );
  });
});
