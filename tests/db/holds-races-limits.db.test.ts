import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { holds } from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { testDevice } from '../deviceFixture';
import { hash, insertHold, insertSession, seedBookable } from './holdFixtures';
import {
  describeFailure,
  holdRaceFixtures,
  lockSession,
  ops,
  request,
} from './holdsRacesFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);
vi.mock('@/server/db/client', async () =>
  (await import('./holdsRacesFixtures')).pooledClientModule(),
);

// The reserve path's real-database concurrency tests (ADR 0002 item 13, ADR 0006), against a client
// with a pool of 25, continued from holds-races.db.test.ts. Behaviours under test:
// - a reserve that supersedes an earlier hold re-reads it under the locks: a hold that moved to paying is
//   kept, one released meanwhile is not superseded, and the freed seats count only if still free
// - one device reserving ten times at once ends with exactly one open hold
// - the per-address and per-device seat limits hold under the locks, and the address lock comes before
//   the session row
// - the cleanup job leaves a hold converted or moved to paying while it waited, and never deadlocks with
//   reserves, releases, and capacity edits

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

const { raceAgainstOpenTransaction, heldSeatsOf } = holdRaceFixtures(
  () => client.db,
);

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
