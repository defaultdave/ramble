import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditOf, seatsSoldOf } from './cancelFixtures';
import {
  backendPid,
  raceAgainstOpenTransaction as race,
  waitUntilBlocked,
} from './harness';
import {
  addDate,
  holdOf,
  moveSnapshot,
  seedMovable,
  sessionOf,
  type MoveWorld,
} from './moveFixtures';
import {
  client,
  jobsOfKind,
  orderOf,
  setupRefundsDatabase,
  side,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (the action `moveBooking`, the fake payment adapter):
// - the locks are the two sessions in id order, then the hold, then the order, whichever way round the ids are: a move waiting on the
//   first session holds nothing else; waiting on the second it holds the first and not the hold or order; waiting on the hold it holds
//   both sessions and not the order (fails if a lock is dropped, or taken in the booking's-session-first order)
// - two bookings moved onto each other's dates at once both move: the sessions are taken in one order, so neither waits on the other
// - a move waiting on the order judges what the holder left: a booking cancelled meanwhile is not movable, a link voided meanwhile opens nothing
// - a move waiting on the date's session judges the date the holder left: seats taken meanwhile make it full, a date cancelled meanwhile
//   is unavailable, and a date that filled while another reserve held the lock is judged with that reserve's hold counted
// - a move waiting on the booking's own session judges the session as the holder left it (it has started)
// - two moves of one booking at once make one move of the first and judge the second from the new date

const move = async (world: MoveWorld, targetSessionId: string) => {
  const { moveBooking } = await import('@/server/actions/orders');
  return moveBooking({ manageToken: world.token, targetSessionId });
};

afterEach(() => {
  vi.useRealTimers();
});

type Row = 'sessions' | 'holds' | 'orders';

/** Whether another connection can take the row's lock right now: false means the move holds it. */
async function isLocked(table: Row, id: string): Promise<boolean> {
  try {
    await side.query(
      `SELECT id FROM ${table} WHERE id = $1 FOR UPDATE NOWAIT`,
      [id],
    );
    return false;
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') return true;
    throw error;
  }
}

/** Holds one row's lock on a connection of its own, starts a move, and waits for it to block. */
async function moveBlockedOn(
  table: Row,
  id: string,
  world: MoveWorld,
  date: string,
) {
  const holder = await side.connect();
  await holder.query('BEGIN');
  await holder.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
  const waiting = move(world, date);
  await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
  return {
    waiting,
    holder,
    release: async () => {
      await holder.query('COMMIT');
      holder.release();
    },
  };
}

/** A date whose id sorts on the wanted side of the booking's own session id. */
async function dateOn(world: MoveWorld, side_: 'before' | 'after') {
  for (let tries = 0; tries < 40; tries += 1) {
    const id = await addDate(world);
    if (id < world.sessionId === (side_ === 'before')) return id;
  }
  throw new Error('no session id on that side');
}

describe.each(['before', 'after'] as const)(
  'the lock order of a move onto a date whose id sorts %s the booking own',
  (position) => {
    const sessionsInOrder = (world: MoveWorld, date: string) =>
      position === 'before'
        ? { first: date, second: world.sessionId }
        : { first: world.sessionId, second: date };

    it('waits on the first session holding nothing else', async () => {
      const world = await seedMovable();
      const date = await dateOn(world, position);
      const { first, second } = sessionsInOrder(world, date);
      const blocked = await moveBlockedOn('sessions', first, world, date);

      expect(await isLocked('sessions', second)).toBe(false);
      expect(await isLocked('holds', world.holdId)).toBe(false);
      expect(await isLocked('orders', world.orderId)).toBe(false);
      await blocked.release();

      expect(await blocked.waiting).toEqual({ status: 'moved' });
    });

    it('waits on the second session holding the first and not the hold or order', async () => {
      const world = await seedMovable();
      const date = await dateOn(world, position);
      const { first, second } = sessionsInOrder(world, date);
      const blocked = await moveBlockedOn('sessions', second, world, date);

      expect(await isLocked('sessions', first)).toBe(true);
      expect(await isLocked('holds', world.holdId)).toBe(false);
      expect(await isLocked('orders', world.orderId)).toBe(false);
      await blocked.release();

      expect(await blocked.waiting).toEqual({ status: 'moved' });
    });

    it('waits on the hold holding both sessions and not the order', async () => {
      const world = await seedMovable();
      const date = await dateOn(world, position);
      const blocked = await moveBlockedOn('holds', world.holdId, world, date);

      expect(await isLocked('sessions', world.sessionId)).toBe(true);
      expect(await isLocked('sessions', date)).toBe(true);
      expect(await isLocked('orders', world.orderId)).toBe(false);
      await blocked.release();

      expect(await blocked.waiting).toEqual({ status: 'moved' });
      expect((await holdOf(world.holdId)).sessionId).toBe(date);
    });
  },
);

describe('two moves at once', () => {
  it('moves two bookings onto each other dates, in 4 rounds, with neither waiting on the other', async () => {
    for (let round = 0; round < 4; round += 1) {
      const one = await seedMovable();
      const other = await seedMovable();

      const answers = await Promise.all([
        move(one, other.sessionId),
        move(other, one.sessionId),
      ]);

      expect(answers).toEqual([{ status: 'moved' }, { status: 'moved' }]);
      expect((await orderOf(one)).sessionId).toBe(other.sessionId);
      expect((await orderOf(other)).sessionId).toBe(one.sessionId);
      expect(await seatsSoldOf(one)).toBe(one.seatsSoldBefore);
      expect(await seatsSoldOf(other)).toBe(other.seatsSoldBefore);
    }
  });

  it('moves one booking once of two at once, and the other answers from the new date', async () => {
    const world = await seedMovable();
    const first = await addDate(world);
    const second = await addDate(world);

    const answers = await Promise.all([
      move(world, first),
      move(world, second),
    ]);

    expect(answers.map((answer) => answer.status)).toEqual(['moved', 'moved']);
    const order = await orderOf(world);
    expect([first, second]).toContain(order.sessionId);
    expect((await holdOf(world.holdId)).sessionId).toBe(order.sessionId);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore - world.seats);
    expect(
      (await sessionOf(first)).seatsSold + (await sessionOf(second)).seatsSold,
    ).toBe(world.seats);
    expect(await auditOf(world)).toHaveLength(2);
  });
});

describe('judged again under the locks', () => {
  it('finds a booking cancelled while the move waited on the order not movable', async () => {
    const world = await seedMovable();
    const date = await addDate(world);
    const blocked = await moveBlockedOn('orders', world.orderId, world, date);
    await blocked.holder.query(
      `UPDATE orders SET status = 'cancelled', cancelled_by = 'ramble', cancelled_at = clock_timestamp() WHERE id = $1`,
      [world.orderId],
    );
    await blocked.release();

    expect(await blocked.waiting).toEqual({ status: 'not_movable' });
    expect((await orderOf(world)).sessionId).toBe(world.sessionId);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore);
    expect((await sessionOf(date)).seatsSold).toBe(0);
    expect(await jobsOfKind('guest-move-confirmation')).toHaveLength(0);
  });

  it('opens nothing for a link voided while the move waited on the order', async () => {
    const world = await seedMovable();
    const date = await addDate(world);
    const blocked = await moveBlockedOn('orders', world.orderId, world, date);
    await blocked.holder.query(
      `UPDATE orders SET manage_token_version = 2 WHERE id = $1`,
      [world.orderId],
    );
    await blocked.release();

    expect(await blocked.waiting).toEqual({ status: 'not_found' });
    expect((await orderOf(world)).sessionId).toBe(world.sessionId);
    expect(await auditOf(world)).toHaveLength(0);
  });

  it('finds a date that filled while the move waited on its session full', async () => {
    const world = await seedMovable();
    const date = await addDate(world);
    const before = await moveSnapshot(world, [date]);
    const blocked = await moveBlockedOn('sessions', date, world, date);
    await blocked.holder.query(
      `UPDATE sessions SET seats_sold = 9 WHERE id = $1`,
      [date],
    );
    await blocked.release();

    expect(await blocked.waiting).toEqual({ status: 'sold_out' });
    expect(await seatsSoldOf(world)).toBe(before.seatsSold.own);
    expect((await sessionOf(date)).seatsSold).toBe(9);
    expect((await orderOf(world)).sessionId).toBe(world.sessionId);
  });

  it('finds a date cancelled while the move waited on its session unavailable', async () => {
    const world = await seedMovable();
    const date = await addDate(world);
    const blocked = await moveBlockedOn('sessions', date, world, date);
    await blocked.holder.query(
      `UPDATE sessions SET status = 'cancelled', cancel_reason = 'host' WHERE id = $1`,
      [date],
    );
    await blocked.release();

    expect(await blocked.waiting).toEqual({ status: 'date_unavailable' });
    expect((await orderOf(world)).sessionId).toBe(world.sessionId);
  });

  it('counts the hold another reserve took on the date while it held the lock', async () => {
    const world = await seedMovable();
    const date = await addDate(world, { allocation: 10, seatsSold: 6 });

    const answer = await race(
      (body) => client.db.transaction(body),
      async (tx) => {
        await tx.execute(
          sql`SELECT id FROM sessions WHERE id = ${date} FOR UPDATE`,
        );
        await tx.execute(
          sql`INSERT INTO holds (session_id, purpose, status, seats, device_key, ip_hash, expires_at)
            VALUES (${date}, 'booking', 'active', ${world.seats + 1}, ${'c'.repeat(64)}, ${'d'.repeat(64)}, now() + make_interval(mins => 10))`,
        );
      },
      () => move(world, date),
    );

    expect(answer).toEqual({ status: 'sold_out' });
    expect((await orderOf(world)).sessionId).toBe(world.sessionId);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore);
  });

  it('finds the booking own session started while the move waited on it not movable', async () => {
    const world = await seedMovable();
    const date = await addDate(world);
    const blocked = await moveBlockedOn(
      'sessions',
      world.sessionId,
      world,
      date,
    );
    await blocked.holder.query(
      `UPDATE sessions SET starts_at = now() - interval '5 minutes', ends_at = now() + interval '90 minutes' WHERE id = $1`,
      [world.sessionId],
    );
    await blocked.release();

    expect(await blocked.waiting).toEqual({ status: 'not_movable' });
    expect((await orderOf(world)).sessionId).toBe(world.sessionId);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore);
  });
});
