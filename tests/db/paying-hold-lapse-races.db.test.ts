import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { insertHold, seedBookable } from './holdFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - a capacity edit that waits for the session lock while a paying hold is still inside its payment
//   window counts that hold, and refuses a cut below sold plus held
// - the same edit, when the paying hold passes its deadline during the wait, no longer counts it and
//   is applied: the open seats are judged at database time read after the lock, not before the wait
//   (the lapse is waited for by polling the database clock, never by a fixed delay)
// - in both, the edit really waited on the lock holder (it is seen blocked)

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let sessionData: typeof import('@/server/db/sessions');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  sessionData = await import('@/server/db/sessions');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

const ops = testCaller({ roles: [Role.Ops] });

/**
 * Holds the session row lock in an open transaction, starts the capacity edit, waits until Postgres
 * reports the edit blocked behind that transaction, runs `beforeCommit` in it, then commits and
 * returns the edit's answer.
 */
async function editWhileSessionLocked<T>(
  sessionId: string,
  edit: () => Promise<T>,
  beforeCommit: (tx: Tx) => Promise<void> = () => Promise.resolve(),
): Promise<T> {
  let held!: (pid: number) => void;
  const holding = new Promise<number>((resolve) => {
    held = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holderDone = client.db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM sessions WHERE id = ${sessionId} FOR UPDATE`,
    );
    const { rows } = await tx.execute<{ pid: number }>(
      sql`SELECT pg_backend_pid() AS pid`,
    );
    held(rows[0]?.pid ?? 0);
    await gate;
    await beforeCommit(tx);
  });
  const holderPid = await holding;

  const state = { settled: false };
  const answer = edit().finally(() => {
    state.settled = true;
  });
  answer.catch(() => undefined);
  let waited = false;
  while (!state.settled && !waited) {
    const { rows } = await client.db.$client.query<{ waiting: number }>(
      'SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [holderPid],
    );
    waited = (rows[0]?.waiting ?? 0) > 0;
  }
  release();
  await holderDone;
  expect(waited, 'the capacity edit waited for the session lock').toBe(true);
  return answer;
}

/** A paying hold of `seats` whose payment window closes about two seconds from now. */
function insertPayingHold(sessionId: string, seats: number) {
  return insertHold(client.db, sessionId, {
    status: 'paying',
    seats,
    expiresAt: sql`clock_timestamp() + interval '1 second'`,
    payingUntil: sql`clock_timestamp() + interval '2 seconds'`,
  });
}

const cutBelowHeld = (sessionId: string) =>
  sessionData.updateSessionAllocation(ops, {
    sessionId,
    allocation: 2,
    expectedVersion: 1,
  });

describe('a capacity edit that waits for the session lock while a paying hold lapses', () => {
  it('counts a paying hold still inside its window, and refuses the cut', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });
    await insertHold(client.db, bookable.session.id, {
      status: 'paying',
      seats: 3,
      payingUntil: sql`now() + interval '15 minutes'`,
    });

    const answer = await editWhileSessionLocked(bookable.session.id, () =>
      cutBelowHeld(bookable.session.id),
    );

    expect(answer).toEqual({
      ok: false,
      reason: 'below_sold_and_held',
      seatsSold: 0,
      heldSeats: 3,
    });
  });

  it('stops counting a paying hold that passed its deadline during the wait, and applies the cut', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });
    const hold = await insertPayingHold(bookable.session.id, 3);

    const answer = await editWhileSessionLocked(
      bookable.session.id,
      () => cutBelowHeld(bookable.session.id),
      async (tx) => {
        const stillOpen = await tx.execute<{ open: boolean }>(
          sql`SELECT clock_timestamp() < paying_until AS open FROM holds WHERE id = ${hold.id}`,
        );
        expect(
          stillOpen.rows[0]?.open,
          'the hold was still inside its window when the edit began to wait',
        ).toBe(true);
        for (;;) {
          const lapsed = await tx.execute<{ lapsed: boolean }>(
            sql`SELECT clock_timestamp() >= paying_until AS lapsed FROM holds WHERE id = ${hold.id}`,
          );
          if (lapsed.rows[0]?.lapsed) return;
        }
      },
    );

    expect(answer).toMatchObject({
      ok: true,
      session: { allocation: 2, version: 2 },
    });
  });
});
