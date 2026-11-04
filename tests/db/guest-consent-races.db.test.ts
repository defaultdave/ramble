import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFreshDatabase, type FreshDatabase } from './harness';

// Behaviours under test, one per decision, branch or risk:
// - a withdrawal in flight and a grant that waits for the guest row: the grant reads the withdrawal
//   the first one committed, so it is recorded and the guest ends granted (without the row lock it
//   reads the old grant, answers unchanged, and the guest's later choice is lost)
// - a grant in flight and a withdrawal that waits: the withdrawal reads the grant and is recorded
//   after it, so the guest ends withdrawn
// - in both, the second change really waited on the first (it is seen blocked, not guessed by delay)

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let store: typeof import('@/server/db/guests');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  store = await import('@/server/db/guests');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

let counter = 0;
async function newGuest() {
  counter += 1;
  const result = await client.db.transaction((tx) =>
    store.findOrCreateGuest(tx, `race-guest-${String(counter)}@example.com`),
  );
  if (result.status !== 'ok') throw new Error('The test email was refused');
  return result.guest;
}

const change = (
  guestId: string,
  status: 'granted' | 'withdrawn',
  source: 'checkout' | 'unsubscribe',
) =>
  client.db.transaction((tx) =>
    store.recordConsent(tx, { guestId, kind: 'newsletter', status, source }),
  );

async function consentStatuses(guestId: string) {
  const { rows } = await client.db.execute<{ status: string }>(
    sql`SELECT status FROM consents WHERE guest_id = ${guestId} AND kind = 'newsletter' ORDER BY recorded_at, id`,
  );
  return rows.map((row) => row.status);
}

/**
 * Holds `holder`'s transaction open, starts `challenger`, waits until Postgres reports the holder
 * blocking some backend, then commits the holder and returns the challenger's answer. The wait is
 * on that condition, not on a delay, so a slow machine cannot pass without the second change
 * having queued behind the first.
 */
async function raceAgainstLock<T>(
  holder: (tx: Tx) => Promise<void>,
  challenger: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: (pid: number) => void;
  const holding = new Promise<number>((resolve) => {
    held = resolve;
  });
  const holderDone = client.db.transaction(async (tx) => {
    await holder(tx);
    const { rows } = await tx.execute<{ pid: number }>(
      sql`SELECT pg_backend_pid() AS pid`,
    );
    held(rows[0]?.pid ?? 0);
    await gate;
  });
  const holderPid = await holding;

  const state = { settled: false };
  const answer = challenger().finally(() => {
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
  expect(waited, 'the second change waited for the first').toBe(true);
  return answer;
}

describe('a consent change that waits for another change to the same guest', () => {
  it('records a grant after a withdrawal committed meanwhile, and ends granted', async () => {
    const guest = await newGuest();
    await change(guest.id, 'granted', 'checkout');

    const answer = await raceAgainstLock(
      async (tx) => {
        const result = await store.recordConsent(tx, {
          guestId: guest.id,
          kind: 'newsletter',
          status: 'withdrawn',
          source: 'unsubscribe',
        });
        expect(result.status).toBe('recorded');
      },
      () => change(guest.id, 'granted', 'checkout'),
    );

    expect(answer.status).toBe('recorded');
    expect(await consentStatuses(guest.id)).toEqual([
      'granted',
      'withdrawn',
      'granted',
    ]);
  });

  it('records a withdrawal after a grant committed meanwhile, and ends withdrawn', async () => {
    const guest = await newGuest();

    const answer = await raceAgainstLock(
      async (tx) => {
        const result = await store.recordConsent(tx, {
          guestId: guest.id,
          kind: 'newsletter',
          status: 'granted',
          source: 'checkout',
        });
        expect(result.status).toBe('recorded');
      },
      () => change(guest.id, 'withdrawn', 'unsubscribe'),
    );

    expect(answer.status).toBe('recorded');
    expect(await consentStatuses(guest.id)).toEqual(['granted', 'withdrawn']);
  });
});
