import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { seedCancellable, type CancelWorld } from './cancelFixtures';
import { serveNeonHttp } from './harness';
import {
  ask,
  client,
  orderOf,
  schema,
  setupRefundsDatabase,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => ({ failWith: null as Error | null }));
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/db/audit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/server/db/audit')>();
  return {
    ...original,
    recordAudit: (entry: Parameters<typeof original.recordAudit>[0]) =>
      audit.failWith
        ? Promise.reject(audit.failWith)
        : original.recordAudit(entry),
    writeAudit: (
      tx: Parameters<typeof original.writeAudit>[0],
      entry: Parameters<typeof original.writeAudit>[1],
    ) =>
      audit.failWith
        ? Promise.reject(audit.failWith)
        : original.writeAudit(tx, entry),
  };
});
setupRefundsDatabase(raise);

// Behaviours under test, against the real database (the read side of the ops bookings area):
// - a reference (any case) finds its booking; an address finds every booking of that guest, by the booking's address or the guest's; a term that is neither finds nothing; each page read writes one audit row
// - the refund-failed filter lists only flagged bookings, and a cursor continues after the last row shown
// - the booking page shows its refunds, writes one audit row for the read, and answers nothing for a missing booking and writes nothing
// - a read whose audit row cannot be written returns nothing, on the list and on a booking

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops: Caller = testCaller({ userId: opsUser, roles: [Role.Ops] });

type Data = typeof import('@/server/db/opsBookings');
let data: Data;
let stopHttp: () => Promise<void>;

// The list reads through the HTTP driver, which the shim serves from the file's own database.
beforeAll(async () => {
  stopHttp = await serveNeonHttp(process.env.DATABASE_URL ?? '');
  data = await import('@/server/db/opsBookings');
});

afterAll(async () => {
  await stopHttp();
});

beforeEach(() => {
  audit.failWith = null;
});

async function auditRows(orderId: string, action?: string) {
  return client.db
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.subjectId, orderId),
        action === undefined ? undefined : eq(schema.auditLog.action, action),
      ),
    );
}

async function contactOf(world: CancelWorld) {
  return (await orderOf(world)).contactEmail;
}

const reference = async (world: CancelWorld) =>
  (await orderOf(world)).reference;

describe('reading the bookings', () => {
  it('finds a booking by its reference, in any case, and records one audit row', async () => {
    const world = await seedCancellable();
    const before = (await client.db.select().from(schema.auditLog)).length;

    const page = await data.readOpsBookings(ops, {
      search: {
        kind: 'reference',
        reference: (await reference(world)).toUpperCase(),
      },
      filter: null,
      cursor: null,
    });

    expect(page.rows.map((row) => row.id)).toEqual([world.orderId]);
    const rows = await client.db.select().from(schema.auditLog);
    expect(rows).toHaveLength(before + 1);
    expect(
      rows.find((row) => row.action === 'booking.list_viewed'),
    ).toMatchObject({ actorId: opsUser });
  });

  it("lists every booking of a guest by an address, the booking's or the guest's", async () => {
    const first = await seedCancellable();
    const second = await seedCancellable();
    const stranger = await seedCancellable();
    const guestEmail = `guest-${randomUUID()}@example.com`;
    const [guest] = await client.db
      .insert(schema.guests)
      .values({ email: guestEmail })
      .returning({ id: schema.guests.id });
    await client.db
      .update(schema.orders)
      .set({ guestId: guest?.id ?? '', contactEmail: 'first@example.com' })
      .where(eq(schema.orders.id, first.orderId));
    await client.db
      .update(schema.orders)
      .set({ guestId: guest?.id ?? '', contactEmail: 'second@example.com' })
      .where(eq(schema.orders.id, second.orderId));

    const ids = async (email: string) =>
      (
        await data.readOpsBookings(ops, {
          search: { kind: 'email', email },
          filter: null,
          cursor: null,
        })
      ).rows.map((row) => row.id);

    expect((await ids(guestEmail)).toSorted()).toEqual(
      [first.orderId, second.orderId].toSorted(),
    );
    expect(await ids('second@example.com')).toEqual([second.orderId]);
    expect(await ids(await contactOf(stranger))).toContain(stranger.orderId);
  });

  it('finds nothing for a term that is neither, and still records the read', async () => {
    await seedCancellable();
    const before = (await client.db.select().from(schema.auditLog)).length;
    const page = await data.readOpsBookings(ops, {
      search: { kind: 'invalid' },
      filter: null,
      cursor: null,
    });
    expect(page).toEqual({ rows: [], nextCursor: null });
    expect(await client.db.select().from(schema.auditLog)).toHaveLength(
      before + 1,
    );
  });

  it('lists only the bookings whose refund failed under the filter, and continues after the cursor', async () => {
    const flagged = await seedCancellable();
    const other = await seedCancellable();
    await client.db
      .update(schema.orders)
      .set({ refundFailed: true })
      .where(eq(schema.orders.id, flagged.orderId));

    const queue = await data.readOpsBookings(ops, {
      search: { kind: 'none' },
      filter: 'refund_failed',
      cursor: null,
    });
    expect(queue.rows.map((row) => row.id)).toContain(flagged.orderId);
    expect(queue.rows.map((row) => row.id)).not.toContain(other.orderId);
    expect(queue.rows.every((row) => row.refundFailed)).toBe(true);

    const all = await data.readOpsBookings(ops, {
      search: { kind: 'none' },
      filter: null,
      cursor: null,
    });
    const first = all.rows[0];
    const next = await data.readOpsBookings(ops, {
      search: { kind: 'none' },
      filter: null,
      cursor: first?.id ?? null,
    });
    expect(next.rows.map((row) => row.id)).not.toContain(first?.id);
    expect(next.rows).toHaveLength(all.rows.length - 1);
  });

  it('shows a booking with its refunds, and records the read', async () => {
    const world = await seedCancellable({ gatewayPayment: true });
    await ask(world, { reason: 'goodwill', key: 'g1' });

    const detail = await data.readOpsBooking(ops, world.orderId);

    expect(detail?.row.id).toBe(world.orderId);
    expect(detail?.refunds).toMatchObject([
      {
        amountLabel: '$130.00',
        reasonLabel: 'Goodwill',
        statusLabel: 'Pending',
      },
    ]);
    expect(detail?.refundedLabel).toBe('$130.00');
    expect(detail?.events.map((event) => event.label)).toEqual([
      'Booking placed',
      'Booking confirmed',
    ]);
    expect(await auditRows(world.orderId, 'booking.viewed')).toMatchObject([
      { actorId: opsUser, subjectKind: 'order' },
    ]);
  });

  it('answers nothing for a missing booking and writes no audit row', async () => {
    const id = randomUUID();
    expect(await data.readOpsBooking(ops, id)).toBeNull();
    expect(await auditRows(id)).toHaveLength(0);
  });

  it('returns nothing when the audit row cannot be written', async () => {
    const world = await seedCancellable();
    audit.failWith = new Error('audit down');
    await expect(
      data.readOpsBookings(ops, {
        search: { kind: 'none' },
        filter: null,
        cursor: null,
      }),
    ).rejects.toThrow('audit down');
    await expect(data.readOpsBooking(ops, world.orderId)).rejects.toThrow(
      'audit down',
    );
  });
});
