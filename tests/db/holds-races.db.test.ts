import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { holds } from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { testDevice } from '../deviceFixture';
import { hash, insertHold, insertSession, seedBookable } from './holdFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

// The reserve path's real-database concurrency tests (ADR 0002 item 13, ADR 0006). The client is
// replaced by one with a pool of 25, so 30 reserves really do compete for connections.
vi.mock('@/server/db/client', async () => {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { Pool } = await import('pg');
  const schema = await import('@/server/db/schema');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 25,
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, dbRead: db };
});

// Behaviours under test, one per decision, branch or risk:
// - 30 parallel one-space reserves from 30 devices on a session of 10: exactly 10 held and 20 sold out,
//   in each of 5 rounds
// - 60 parallel reserves of 1 to 3 spaces across 3 sessions of 10: no session ever holds more than 10
//   seats, and the seats held are the seats the held answers asked for, in each of 5 rounds
// - a reserve that waits for the session lock re-reads after it: a hold committed meanwhile makes it
//   sold_out, a cancellation committed meanwhile makes it session_cancelled (each fails if the locked
//   re-check is removed)
// - the device lock comes before the session lock: while a second connection holds the device lock,
//   the reserve waits and a third connection can still take the session row with NOWAIT
// - a capacity edit and a release re-check what they read once they hold the locks
// - a hold's created_at and updated_at come from a time read after the lock wait
// - reserve, release, and capacity edit on one session in parallel, 50 rounds: no deadlock, no error, and
//   seats sold plus open held seats never exceeds the allocation

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let holdData: typeof import('@/server/db/holds');
let sessionData: typeof import('@/server/db/sessions');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  holdData = await import('@/server/db/holds');
  sessionData = await import('@/server/db/sessions');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

type Bookable = Awaited<ReturnType<typeof seedBookable>>;
type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

// A failed query's message hides the Postgres error; the report needs its code and text.
const describeFailure = (reason: unknown) => {
  const cause = reason instanceof Error ? reason.cause : undefined;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return `${String(reason)} | cause ${String(code)}: ${cause.message}`;
  }
  return String(reason);
};

const ops = testCaller({ roles: [Role.Ops] });
const aFewMoments = () => new Promise((resolve) => setTimeout(resolve, 300));

const request = (sessionId: string, bookable: Bookable, quantity = 1) => ({
  sessionId,
  items: [{ priceOptionId: bookable.adult.id, quantity }],
  purpose: 'booking' as const,
});

const lockSession = (tx: Tx, sessionId: string) =>
  tx.execute(sql`SELECT id FROM sessions WHERE id = ${sessionId} FOR UPDATE`);

/**
 * Runs `holder` in a transaction that stays open, starts `challenger` on another connection,
 * checks the challenger is still waiting, then commits the holder and returns what the challenger
 * answered. A challenger that does not wait was not serialized by the lock. `whileWaiting` runs
 * on a third connection during the wait, and `beforeCommit` runs in the holder just before it commits.
 */
async function raceAgainstOpenTransaction<T>(
  holder: (tx: Tx) => Promise<void>,
  challenger: () => Promise<T>,
  hooks: {
    whileWaiting?: () => Promise<void>;
    beforeCommit?: (tx: Tx) => Promise<void>;
  } = {},
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: () => void;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const holderDone = client.db.transaction(async (tx) => {
    await holder(tx);
    held();
    await gate;
    await hooks.beforeCommit?.(tx);
  });
  await holding;

  let settled = false;
  const answer = challenger().finally(() => {
    settled = true;
  });
  answer.catch(() => undefined);
  await aFewMoments();
  const waited = !settled;
  await hooks.whileWaiting?.();
  release();
  await holderDone;
  expect(waited, 'the challenger waited for the holder').toBe(true);
  return answer;
}

async function heldSeatsOf(sessionId: string): Promise<number> {
  const result = await client.db.execute(sql`
    SELECT coalesce(sum(seats), 0)::int AS seats FROM holds
    WHERE session_id = ${sessionId}
      AND ((status = 'active' AND expires_at > now()) OR (status = 'paying' AND paying_until > now()))
  `);
  return (result.rows[0] as { seats: number }).seats;
}

describe('parallel reserves', () => {
  it('30 devices after 10 spaces: exactly 10 held and 20 sold out, 5 rounds', async () => {
    for (let round = 0; round < 5; round += 1) {
      const bookable = await seedBookable(client.db, { allocation: 10 });
      const devices = await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          testDevice(`thirty-${String(round)}-${String(index)}`),
        ),
      );

      const answers = await Promise.all(
        devices.map((device) =>
          holdData.reserveSpaces(
            device,
            request(bookable.session.id, bookable),
          ),
        ),
      );

      const statuses = answers.map((answer) => answer.status);
      expect(statuses.filter((status) => status === 'held')).toHaveLength(10);
      expect(statuses.filter((status) => status === 'sold_out')).toHaveLength(
        20,
      );
      expect(await heldSeatsOf(bookable.session.id)).toBe(10);
    }
  });

  it('60 reserves of 1 to 3 spaces across 3 sessions of 10: never more than 10 held, 5 rounds', async () => {
    for (let round = 0; round < 5; round += 1) {
      const bookable = await seedBookable(client.db, { allocation: 10 });
      const sessionIds = [
        bookable.session.id,
        (await insertSession(client.db, bookable.experience.id)).id,
        (await insertSession(client.db, bookable.experience.id)).id,
      ];
      const asks = await Promise.all(
        Array.from({ length: 60 }, async (_, index) => ({
          sessionId: sessionIds[index % 3] ?? bookable.session.id,
          quantity: ((index * 7) % 3) + 1,
          device: await testDevice(`sixty-${String(round)}-${String(index)}`),
        })),
      );

      const answers = await Promise.all(
        asks.map((ask) =>
          holdData.reserveSpaces(
            ask.device,
            request(ask.sessionId, bookable, ask.quantity),
          ),
        ),
      );

      for (const sessionId of sessionIds) {
        const accepted = asks
          .filter(
            (ask, index) =>
              ask.sessionId === sessionId && answers[index]?.status === 'held',
          )
          .reduce((total, ask) => total + ask.quantity, 0);
        const stored = await heldSeatsOf(sessionId);
        expect(stored).toBeLessThanOrEqual(10);
        expect(stored).toBe(accepted);
      }
    }
  });
});

describe('a reserve that waited for the session lock', () => {
  it('re-reads the spaces, so a hold committed meanwhile makes it sold out', async () => {
    const bookable = await seedBookable(client.db, { allocation: 1 });

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await insertHold(tx, bookable.session.id, {
          deviceKey: hash('c'),
          ipHash: hash('d'),
          seats: 1,
        });
      },
      async () =>
        holdData.reserveSpaces(
          await testDevice('late-device'),
          request(bookable.session.id, bookable),
        ),
    );

    expect(answer.status).toBe('sold_out');
  });

  it('re-reads the session, so a cancellation committed meanwhile refuses it', async () => {
    const bookable = await seedBookable(client.db);

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await tx.execute(
          sql`UPDATE sessions SET status = 'cancelled', cancel_reason = 'host' WHERE id = ${bookable.session.id}`,
        );
      },
      async () =>
        holdData.reserveSpaces(
          await testDevice('late-device'),
          request(bookable.session.id, bookable),
        ),
    );

    expect(answer).toEqual({
      status: 'unavailable',
      reason: 'session_cancelled',
    });
  });

  it('takes the time of the hold after the wait, not before it', async () => {
    const bookable = await seedBookable(client.db);
    let releasedAt = 0;

    const answer = await raceAgainstOpenTransaction(
      (tx) => lockSession(tx, bookable.session.id).then(() => undefined),
      async () =>
        holdData.reserveSpaces(
          await testDevice('timed-device'),
          request(bookable.session.id, bookable),
        ),
      {
        beforeCommit: async (tx) => {
          const result = await tx.execute(
            sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms`,
          );
          releasedAt = Number((result.rows[0] as { ms: string }).ms);
        },
      },
    );

    if (answer.status !== 'held') throw new Error('expected held');
    const [stored] = await client.db
      .select()
      .from(holds)
      .where(eq(holds.id, answer.holdId));
    expect(stored?.createdAt.getTime()).toBeGreaterThanOrEqual(releasedAt);
    expect(stored?.updatedAt.getTime()).toBeGreaterThanOrEqual(releasedAt);
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(releasedAt);
  });
});

describe('the lock order', () => {
  it('takes the device lock before the session row', async () => {
    const bookable = await seedBookable(client.db);
    const device = await testDevice('ordered-device');

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`hold-device:${device.deviceKey}`}))`,
        );
      },
      () =>
        holdData.reserveSpaces(device, request(bookable.session.id, bookable)),
      {
        // Fails with 55P03 if the reserve had already locked the session row while waiting for the device.
        whileWaiting: async () => {
          await client.db.transaction((tx) =>
            tx.execute(
              sql`SELECT id FROM sessions WHERE id = ${bookable.session.id} FOR UPDATE NOWAIT`,
            ),
          );
        },
      },
    );

    expect(answer.status).toBe('held');
  });
});

describe('a capacity edit and a release that waited for the session lock', () => {
  it('count the hold committed meanwhile', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await insertHold(tx, bookable.session.id, {
          deviceKey: hash('c'),
          ipHash: hash('d'),
          seats: 3,
        });
      },
      () =>
        sessionData.updateSessionAllocation(ops, {
          sessionId: bookable.session.id,
          allocation: 2,
          expectedVersion: 1,
        }),
    );

    expect(answer).toEqual({
      ok: false,
      reason: 'below_sold_and_held',
      seatsSold: 0,
      heldSeats: 3,
    });
  });

  it('see a hold that moved to paying meanwhile, and refuse to release it', async () => {
    const bookable = await seedBookable(client.db);
    const device = await testDevice('releasing-device');
    const hold = await insertHold(client.db, bookable.session.id, {
      deviceKey: device.deviceKey,
    });

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await tx.execute(
          sql`UPDATE holds SET status = 'paying', paying_until = expires_at + interval '5 minutes' WHERE id = ${hold.id}`,
        );
      },
      () => holdData.releaseHold(device, { holdId: hold.id }),
    );

    expect(answer).toEqual({ status: 'payment_in_progress' });
    const [stored] = await client.db
      .select()
      .from(holds)
      .where(eq(holds.id, hold.id));
    expect(stored?.status).toBe('paying');
  });

  it('waits for the session row alone, before it looks at the hold', async () => {
    const bookable = await seedBookable(client.db);
    const device = await testDevice('session-row-device');
    const hold = await insertHold(client.db, bookable.session.id, {
      deviceKey: device.deviceKey,
    });

    const answer = await raceAgainstOpenTransaction(
      (tx) => lockSession(tx, bookable.session.id).then(() => undefined),
      () => holdData.releaseHold(device, { holdId: hold.id }),
    );

    expect(answer).toEqual({ status: 'released' });
  });

  it('waits for the hold row alone, and sees what a holder of only that row changed', async () => {
    const bookable = await seedBookable(client.db);
    const device = await testDevice('hold-row-device');
    const hold = await insertHold(client.db, bookable.session.id, {
      deviceKey: device.deviceKey,
    });

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT id FROM holds WHERE id = ${hold.id} FOR UPDATE`,
        );
        await tx.execute(
          sql`UPDATE holds SET status = 'paying', paying_until = expires_at + interval '5 minutes' WHERE id = ${hold.id}`,
        );
      },
      () => holdData.releaseHold(device, { holdId: hold.id }),
    );

    expect(answer).toEqual({ status: 'payment_in_progress' });
  });

  it('see a hold that was converted meanwhile, and answer not_found', async () => {
    const bookable = await seedBookable(client.db);
    const device = await testDevice('converting-device');
    const hold = await insertHold(client.db, bookable.session.id, {
      deviceKey: device.deviceKey,
    });

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await tx.execute(
          sql`UPDATE holds SET status = 'converted' WHERE id = ${hold.id}`,
        );
      },
      () => holdData.releaseHold(device, { holdId: hold.id }),
    );

    expect(answer).toEqual({ status: 'not_found' });
  });
});

describe('reserve, release, and capacity edit together', () => {
  it('never deadlock, and never let sold plus held pass the allocation, in 50 rounds', async () => {
    const bookable = await seedBookable(client.db, { allocation: 6 });
    const owner: Device = await testDevice('mixed-owner');

    for (let round = 0; round < 50; round += 1) {
      const session = await insertSession(client.db, bookable.experience.id, {
        allocation: 6,
      });
      const mine = await insertHold(client.db, session.id, {
        deviceKey: owner.deviceKey,
        seats: 2,
      });
      const tag = String(round);
      const guestA = await testDevice(`mixed-a-${tag}`);
      const guestB = await testDevice(`mixed-b-${tag}`);
      const guestC = await testDevice(`mixed-c-${tag}`);

      const outcomes = await Promise.allSettled([
        holdData.reserveSpaces(guestA, request(session.id, bookable, 3)),
        holdData.reserveSpaces(guestB, request(session.id, bookable, 2)),
        holdData.reserveSpaces(guestC, request(session.id, bookable, 1)),
        holdData.releaseHold(owner, { holdId: mine.id }),
        sessionData.updateSessionAllocation(ops, {
          sessionId: session.id,
          allocation: 3,
          expectedVersion: 1,
        }),
      ]);

      const failures = outcomes.filter(
        (outcome) => outcome.status === 'rejected',
      );
      expect(
        failures.map((outcome) => describeFailure(outcome.reason)),
        'no operation threw, deadlock (40P01) included',
      ).toEqual([]);
      const result = await client.db.execute(
        sql`SELECT allocation, seats_sold FROM sessions WHERE id = ${session.id}`,
      );
      const row = result.rows[0] as { allocation: number; seats_sold: number };
      expect(
        row.seats_sold + (await heldSeatsOf(session.id)),
      ).toBeLessThanOrEqual(row.allocation);
    }
  }, 120_000);
});

describe('superseding under the locks', () => {
  it('does not supersede a hold that moved to paying while the reserve waited for the session lock', async () => {
    const bookable = await seedBookable(client.db);
    const device = await testDevice('supersede-paying');
    const earlier = await insertHold(client.db, bookable.session.id, {
      deviceKey: device.deviceKey,
      ipHash: device.ipHash,
    });

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await tx.execute(
          sql`UPDATE holds SET status = 'paying', paying_until = expires_at + interval '5 minutes' WHERE id = ${earlier.id}`,
        );
      },
      () =>
        holdData.reserveSpaces(device, request(bookable.session.id, bookable)),
    );

    expect(answer.status).toBe('held');
    const [stored] = await client.db
      .select()
      .from(holds)
      .where(eq(holds.id, earlier.id));
    expect(stored).toMatchObject({ status: 'paying', supersededBy: null });
  });

  it('supersedes nothing when the earlier hold was released while the reserve waited', async () => {
    const bookable = await seedBookable(client.db);
    const device = await testDevice('supersede-released');
    const earlier = await insertHold(client.db, bookable.session.id, {
      deviceKey: device.deviceKey,
      ipHash: device.ipHash,
    });

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await tx.execute(
          sql`UPDATE holds SET status = 'released', released_reason = 'guest_left' WHERE id = ${earlier.id}`,
        );
      },
      () =>
        holdData.reserveSpaces(device, request(bookable.session.id, bookable)),
    );

    expect(answer.status).toBe('held');
    const [stored] = await client.db
      .select()
      .from(holds)
      .where(eq(holds.id, earlier.id));
    expect(stored).toMatchObject({
      releasedReason: 'guest_left',
      supersededBy: null,
    });
  });

  it('counts the superseded hold as free when another device took the rest of the session meanwhile', async () => {
    const bookable = await seedBookable(client.db, { allocation: 4 });
    const device = await testDevice('supersede-room');
    const earlier = await insertHold(client.db, bookable.session.id, {
      deviceKey: device.deviceKey,
      ipHash: device.ipHash,
      seats: 2,
    });

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await insertHold(tx, bookable.session.id, {
          deviceKey: hash('c'),
          ipHash: hash('d'),
          seats: 2,
        });
      },
      () =>
        holdData.reserveSpaces(
          device,
          request(bookable.session.id, bookable, 2),
        ),
    );

    expect(answer.status).toBe('held');
    const [stored] = await client.db
      .select()
      .from(holds)
      .where(eq(holds.id, earlier.id));
    expect(stored?.releasedReason).toBe('superseded');
  });

  it('keeps exactly one open hold when one device reserves ten times at once', async () => {
    const bookable = await seedBookable(client.db);
    const device = await testDevice('supersede-storm');

    const answers = await Promise.all(
      Array.from({ length: 10 }, () =>
        holdData.reserveSpaces(device, request(bookable.session.id, bookable)),
      ),
    );

    expect(answers.map((answer) => answer.status)).toEqual(
      Array.from({ length: 10 }, () => 'held'),
    );
    const rows = await client.db
      .select({ status: holds.status, reason: holds.releasedReason })
      .from(holds)
      .where(eq(holds.sessionId, bookable.session.id));
    expect(rows.filter(({ status }) => status === 'active')).toHaveLength(1);
    expect(rows.filter(({ reason }) => reason === 'superseded')).toHaveLength(
      9,
    );
  });
});

describe('the limits under the locks', () => {
  it('holds twelve devices on one address to six seats in all, in 5 rounds', async () => {
    for (let round = 0; round < 5; round += 1) {
      const bookable = await seedBookable(client.db, { allocation: 20 });
      const address = `203.0.113.${String(round + 1)}`;
      const devices = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          testDevice(`shared-${String(round)}-${String(index)}`, address),
        ),
      );

      const answers = await Promise.all(
        devices.map((device) =>
          holdData.reserveSpaces(
            device,
            request(bookable.session.id, bookable),
          ),
        ),
      );

      const statuses = answers.map((answer) => answer.status);
      expect(statuses.filter((status) => status === 'held')).toHaveLength(6);
      expect(statuses.filter((status) => status === 'blocked')).toHaveLength(6);
      expect(await heldSeatsOf(bookable.session.id)).toBe(6);
    }
  });

  it('holds twelve devices on one address to six seats across twelve different sessions, in 5 rounds', async () => {
    for (let round = 0; round < 5; round += 1) {
      const bookable = await seedBookable(client.db);
      const sessionIds = [bookable.session.id];
      for (let index = 1; index < 12; index += 1) {
        sessionIds.push(
          (await insertSession(client.db, bookable.experience.id)).id,
        );
      }
      const address = `198.51.100.${String(round + 1)}`;
      const devices = await Promise.all(
        sessionIds.map((_, index) =>
          testDevice(`spread-${String(round)}-${String(index)}`, address),
        ),
      );

      const answers = await Promise.all(
        devices.map((device, index) =>
          holdData.reserveSpaces(
            device,
            request(sessionIds[index] ?? bookable.session.id, bookable),
          ),
        ),
      );

      expect(answers.filter(({ status }) => status === 'held')).toHaveLength(6);
      expect(answers.filter(({ status }) => status === 'blocked')).toHaveLength(
        6,
      );
      const total = await client.db.execute(
        sql`SELECT coalesce(sum(seats), 0)::int AS seats FROM holds WHERE ip_hash = ${devices[0]?.ipHash ?? ''} AND status = 'active'`,
      );
      expect((total.rows[0] as { seats: number }).seats).toBe(6);
    }
  });

  it('keeps one device to six seats across sessions when it reserves in all of them at once', async () => {
    const bookable = await seedBookable(client.db, { allocation: 20 });
    const sessionIds = [bookable.session.id];
    for (let index = 0; index < 5; index += 1) {
      sessionIds.push(
        (await insertSession(client.db, bookable.experience.id)).id,
      );
    }
    const device = await testDevice('across-sessions');

    const answers = await Promise.all(
      sessionIds.map((sessionId) =>
        holdData.reserveSpaces(device, request(sessionId, bookable, 2)),
      ),
    );

    expect(answers.filter(({ status }) => status === 'held')).toHaveLength(3);
    expect(answers.filter(({ status }) => status === 'blocked')).toHaveLength(
      3,
    );
  });

  it('takes the address lock before the session row', async () => {
    const bookable = await seedBookable(client.db);
    const device = await testDevice('address-ordered');

    const answer = await raceAgainstOpenTransaction(
      async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`hold-address:${device.ipHash}`}))`,
        );
      },
      () =>
        holdData.reserveSpaces(device, request(bookable.session.id, bookable)),
      {
        // Fails with 55P03 if the reserve had already locked the session row while waiting for the address.
        whileWaiting: async () => {
          await client.db.transaction((tx) =>
            tx.execute(
              sql`SELECT id FROM sessions WHERE id = ${bookable.session.id} FOR UPDATE NOWAIT`,
            ),
          );
        },
      },
    );

    expect(answer.status).toBe('held');
  });
});

describe('the cleanup job under the locks', () => {
  it('leaves a hold that was converted while the job waited for the session lock', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await insertHold(client.db, bookable.session.id, {
      createdAt: sql`now() - interval '20 minutes'`,
    });

    const released = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await tx.execute(
          sql`UPDATE holds SET status = 'converted' WHERE id = ${lapsed.id}`,
        );
      },
      () => holdData.releaseLapsedHolds(),
    );

    expect(released).toBe(0);
    const [stored] = await client.db
      .select()
      .from(holds)
      .where(eq(holds.id, lapsed.id));
    expect(stored).toMatchObject({ status: 'converted', releasedReason: null });
  });

  it('leaves a hold that moved to paying with a new deadline while the job waited', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await insertHold(client.db, bookable.session.id, {
      createdAt: sql`now() - interval '20 minutes'`,
    });

    const released = await raceAgainstOpenTransaction(
      async (tx) => {
        await lockSession(tx, bookable.session.id);
        await tx.execute(
          sql`UPDATE holds SET status = 'paying', paying_until = now() + interval '5 minutes' WHERE id = ${lapsed.id}`,
        );
      },
      () => holdData.releaseLapsedHolds(),
    );

    expect(released).toBe(0);
    const [stored] = await client.db
      .select()
      .from(holds)
      .where(eq(holds.id, lapsed.id));
    expect(stored?.status).toBe('paying');
  });

  it('never deadlocks with reserves, releases, and capacity edits on one session, in 30 rounds', async () => {
    const bookable = await seedBookable(client.db, { allocation: 6 });
    const owner: Device = await testDevice('cleanup-owner');

    for (let round = 0; round < 30; round += 1) {
      const session = await insertSession(client.db, bookable.experience.id, {
        allocation: 6,
      });
      await insertHold(client.db, session.id, {
        createdAt: sql`now() - interval '20 minutes'`,
      });
      const mine = await insertHold(client.db, session.id, {
        deviceKey: owner.deviceKey,
        ipHash: owner.ipHash,
        seats: 2,
      });
      const tag = String(round);
      const guestA = await testDevice(`cleanup-a-${tag}`);
      const guestB = await testDevice(`cleanup-b-${tag}`);

      const outcomes = await Promise.allSettled([
        holdData.reserveSpaces(guestA, request(session.id, bookable, 3)),
        holdData.reserveSpaces(guestA, request(session.id, bookable, 2)),
        holdData.reserveSpaces(guestB, request(session.id, bookable, 2)),
        holdData.releaseHold(owner, { holdId: mine.id }),
        holdData.releaseLapsedHolds(),
        sessionData.updateSessionAllocation(ops, {
          sessionId: session.id,
          allocation: 3,
          expectedVersion: 1,
        }),
      ]);

      expect(
        outcomes
          .filter((outcome) => outcome.status === 'rejected')
          .map((outcome) => describeFailure(outcome.reason)),
        'no operation threw, deadlock (40P01) included',
      ).toEqual([]);
      const result = await client.db.execute(
        sql`SELECT allocation, seats_sold FROM sessions WHERE id = ${session.id}`,
      );
      const row = result.rows[0] as { allocation: number; seats_sold: number };
      expect(
        row.seats_sold + (await heldSeatsOf(session.id)),
      ).toBeLessThanOrEqual(row.allocation);
    }
  }, 120_000);
});
