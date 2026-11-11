import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  backendPid,
  createFreshDatabase,
  serveNeonHttp,
  waitUntilBlocked,
  type FreshDatabase,
} from './harness';
import { hash } from './holdFixtures';
import { sessionsFixtures } from './sessionsFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - a time change or a cancel that waits on the session's row lock sees a booking or a hold that
//   committed meanwhile, so the edit is refused and the session is as it was: the lock guards the
//   write, and the seats sold and the holds are read after it, not before

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let sessionData: typeof import('@/server/db/sessions');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  sessionData = await import('@/server/db/sessions');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const { generated, stored } = sessionsFixtures(
  () => client,
  () => sessionData,
);

// The generated session is Saturday 2026-06-06, 10:00 New York, version 1; the edits are made the
// week before.
const beforeTheDay = new Date('2026-05-30T00:00:00Z');

/** Holds the row lock, starts the edit, runs `change` once the edit waits, then commits. */
async function editWhileLocked<Result>(
  sessionId: string,
  edit: () => Promise<Result>,
  change: (held: PoolClient) => Promise<unknown>,
) {
  const held = await client.db.$client.connect();
  try {
    await held.query('BEGIN');
    await held.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [
      sessionId,
    ]);
    const holderPid = await backendPid(held);
    const pending = edit();
    await waitUntilBlocked(client.db.$client, { blockedBy: holderPid });
    await change(held);
    await held.query('COMMIT');
    return await pending;
  } finally {
    held.release();
  }
}

const sellASeat = (sessionId: string) => (held: PoolClient) =>
  held.query('UPDATE sessions SET seats_sold = 1 WHERE id = $1', [sessionId]);

// Written on the lock holder's own connection: a hold's foreign key to the session would wait on
// the row lock from any other.
const openAHold = (sessionId: string) => (held: PoolClient) =>
  held.query(
    `INSERT INTO holds (session_id, purpose, status, seats, device_key, ip_hash, created_at, updated_at, expires_at)
     VALUES ($1, 'booking', 'active', 2, $2, $3, now(), now(), now() + make_interval(mins => 10))`,
    [sessionId, hash('a'), hash('b')],
  );

describe('an edit that needs an unbooked session', () => {
  const edits = {
    'a time change': (
      owner: Parameters<typeof sessionData.cancelUnbookedSession>[0],
      id: string,
    ) =>
      sessionData.updateSessionTime(
        owner,
        {
          sessionId: id,
          startTime: '13:30',
          durationMinutes: 90,
          expectedVersion: 1,
        },
        beforeTheDay,
      ),
    'a cancel': (
      owner: Parameters<typeof sessionData.cancelUnbookedSession>[0],
      id: string,
    ) =>
      sessionData.cancelUnbookedSession(
        owner,
        { sessionId: id, expectedVersion: 1 },
        beforeTheDay,
      ),
  };

  it.each([
    ['a time change', 'a booking', sellASeat, 'has_bookings'],
    ['a time change', 'a hold', openAHold, 'has_holds'],
    ['a cancel', 'a booking', sellASeat, 'has_bookings'],
    ['a cancel', 'a hold', openAHold, 'has_holds'],
  ] as const)(
    '%s that waits for the lock is refused when %s commits meanwhile',
    async (editName, _what, commit, reason) => {
      const { session, owner } = await generated();

      const outcome = await editWhileLocked(
        session.id,
        () => edits[editName](owner, session.id),
        commit(session.id),
      );

      expect(outcome).toEqual({ ok: false, reason });
      expect(await stored(session.id)).toMatchObject({
        startsAt: new Date('2026-06-06T14:00:00Z'),
        endsAt: new Date('2026-06-06T16:00:00Z'),
        status: 'scheduled',
        version: 1,
      });
    },
  );

  it.each(['a time change', 'a cancel'] as const)(
    '%s goes ahead when nothing commits while it waits',
    async (editName) => {
      const { session, owner } = await generated();

      const outcome = await editWhileLocked(
        session.id,
        () => edits[editName](owner, session.id),
        () => Promise.resolve(),
      );

      expect(outcome).toMatchObject({ ok: true, session: { version: 2 } });
    },
  );
});
