import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendPid, waitUntilBlocked } from './harness';
import { seatsSoldOf } from './cancelFixtures';
import {
  addDate,
  holdOf,
  seedMovable,
  sessionOf,
  type MoveWorld,
} from './moveFixtures';
import {
  clearJobs,
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

// Behaviours under test, one per decision, branch, or risk (a move changes the session an order points at while a path that read it
// without a lock waits for that session's lock):
// - a cancel that read the old session and waited for its lock starts over on the session the booking moved to, and returns the seats
//   there and not to the old one (fails if the locked order is not checked against the session that was locked)
// - a move that read the old session and waited for its lock starts over from the session the booking moved to, takes the seats off
//   that one, and judges the date chosen from there
// - a cancel and a move of one booking at once, in 4 rounds, end with the booking cancelled and every seat returned once, whichever came first

afterEach(() => {
  vi.useRealTimers();
});

const cancel = async (world: MoveWorld) => {
  const { cancelBooking } = await import('@/server/actions/orders');
  return cancelBooking({
    manageToken: world.token,
    expectedRefundMinor: 13_000,
  });
};

const move = async (world: MoveWorld, targetSessionId: string) => {
  const { moveBooking } = await import('@/server/actions/orders');
  return moveBooking({ manageToken: world.token, targetSessionId });
};

/**
 * Holds the booking's own session lock and the one it moves to, starts the path (which blocks on it after reading the old
 * session), then commits a move of the booking to `to` as another move would have, and lets the path go on.
 */
async function pathWaitingWhileBookingMoves<T>(
  world: MoveWorld,
  to: string,
  path: () => Promise<T>,
): Promise<T> {
  const holder = await side.connect();
  await holder.query('BEGIN');
  // Both sessions, in id order as a move takes them, so a path that locks the other one first waits on the holder too.
  for (const id of [world.sessionId, to].sort()) {
    await holder.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [
      id,
    ]);
  }
  const waiting = path();
  await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
  await holder.query('UPDATE orders SET session_id = $2 WHERE id = $1', [
    world.orderId,
    to,
  ]);
  await holder.query('UPDATE holds SET session_id = $2 WHERE id = $1', [
    world.holdId,
    to,
  ]);
  await holder.query(
    'UPDATE sessions SET seats_sold = seats_sold - $2 WHERE id = $1',
    [world.sessionId, world.seats],
  );
  await holder.query(
    'UPDATE sessions SET seats_sold = seats_sold + $2 WHERE id = $1',
    [to, world.seats],
  );
  await holder.query('COMMIT');
  holder.release();
  return waiting;
}

describe('a path that waited while the booking moved', () => {
  it('has a cancel start over on the new session and return the seats there', async () => {
    const world = await seedMovable();
    const date = await addDate(world, { seatsSold: 4 });

    const answer = await pathWaitingWhileBookingMoves(world, date, () =>
      cancel(world),
    );

    expect(answer).toMatchObject({ status: 'cancelled' });
    expect((await orderOf(world)).status).toBe('cancelled');
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore - world.seats);
    expect((await sessionOf(date)).seatsSold).toBe(4);
  });

  it('has a move start over from the new session and take the seats off that one', async () => {
    const world = await seedMovable();
    const date = await addDate(world, { seatsSold: 4 });
    const target = await addDate(world, { seatsSold: 1 });

    const answer = await pathWaitingWhileBookingMoves(world, date, () =>
      move(world, target),
    );

    expect(answer).toEqual({ status: 'moved' });
    expect((await orderOf(world)).sessionId).toBe(target);
    expect((await holdOf(world.holdId)).sessionId).toBe(target);
    expect(await seatsSoldOf(world)).toBe(world.seatsSoldBefore - world.seats);
    expect((await sessionOf(date)).seatsSold).toBe(4);
    expect((await sessionOf(target)).seatsSold).toBe(1 + world.seats);
  });

  it('has a move onto the session the booking moved to answer that it is the same date', async () => {
    const world = await seedMovable();
    const date = await addDate(world);

    const answer = await pathWaitingWhileBookingMoves(world, date, () =>
      move(world, date),
    );

    expect(answer).toEqual({ status: 'same_date' });
    expect((await orderOf(world)).sessionId).toBe(date);
    expect((await sessionOf(date)).seatsSold).toBe(world.seats);
  });
});

describe('a cancel and a move of one booking at once', () => {
  it('ends with the booking cancelled and every seat returned once, in 4 rounds', async () => {
    for (let round = 0; round < 4; round += 1) {
      await clearJobs();
      const world = await seedMovable();
      const date = await addDate(world);

      const [cancelled, moved] = await Promise.all([
        cancel(world),
        move(world, date),
      ]);

      expect(cancelled).toMatchObject({ status: 'cancelled' });
      expect(['moved', 'not_movable']).toContain(moved.status);
      expect((await orderOf(world)).status).toBe('cancelled');
      expect(await seatsSoldOf(world)).toBe(
        world.seatsSoldBefore - world.seats,
      );
      expect((await sessionOf(date)).seatsSold).toBe(0);
    }
  });
});
