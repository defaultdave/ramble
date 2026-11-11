import { eq } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, type Caller } from '@/server/auth/caller';
import { sessions } from '@/server/db/schema';
import {
  backendPid,
  createFreshDatabase,
  serveNeonHttp,
  waitUntilBlocked,
  type FreshDatabase,
} from './harness';
import { earlyNow, sessionsFixtures } from './sessionsFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - a capacity edit raises, lowers to exactly the seats sold, and refuses below it; a stale version
//   is refused; two edits on one version let one win; the seats sold are read under the row lock
// - the capacity edit re-checks the caller and the session's state under the lock

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

/** The sessions here are in June 2026, so every edit is made on a day before them. */
const editCapacity = (
  caller: Caller,
  input: Parameters<typeof sessionData.updateSessionAllocation>[1],
) => sessionData.updateSessionAllocation(caller, input, earlyNow);

describe('updateSessionAllocation', () => {
  it('raises the capacity and bumps the version', async () => {
    const { session, owner } = await generated();

    const result = await editCapacity(owner, {
      sessionId: session.id,
      allocation: 12,
      expectedVersion: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      session: { id: session.id, allocation: 12, version: 2 },
    });
    expect(await stored(session.id)).toMatchObject({
      allocation: 12,
      version: 2,
    });
  });

  it('lowers the capacity to exactly the seats sold', async () => {
    const { session, owner } = await generated();
    await client.db
      .update(sessions)
      .set({ seatsSold: 5 })
      .where(eq(sessions.id, session.id));

    const result = await editCapacity(owner, {
      sessionId: session.id,
      allocation: 5,
      expectedVersion: 1,
    });

    expect(result).toMatchObject({ ok: true, session: { allocation: 5 } });
  });

  it('refuses a capacity below the seats sold, naming them, and changes nothing', async () => {
    const { session, owner } = await generated();
    await client.db
      .update(sessions)
      .set({ seatsSold: 5 })
      .where(eq(sessions.id, session.id));

    const result = await editCapacity(owner, {
      sessionId: session.id,
      allocation: 4,
      expectedVersion: 1,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'below_sold_and_held',
      seatsSold: 5,
      heldSeats: 0,
    });
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      seatsSold: 5,
      version: 1,
    });
  });

  it('refuses a stale version and changes nothing', async () => {
    const { session, owner } = await generated();
    await editCapacity(owner, {
      sessionId: session.id,
      allocation: 9,
      expectedVersion: 1,
    });

    const result = await editCapacity(owner, {
      sessionId: session.id,
      allocation: 10,
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, reason: 'version_conflict' });
    expect(await stored(session.id)).toMatchObject({
      allocation: 9,
      version: 2,
    });
  });

  it('lets one of two edits on the same version win', async () => {
    const { session, owner } = await generated();

    const results = await Promise.all([
      editCapacity(owner, {
        sessionId: session.id,
        allocation: 9,
        expectedVersion: 1,
      }),
      editCapacity(owner, {
        sessionId: session.id,
        allocation: 10,
        expectedVersion: 1,
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: 'version_conflict' },
    ]);
    expect((await stored(session.id)).version).toBe(2);
  });

  it('reads the seats sold under the row lock, so a booking that confirms first is counted', async () => {
    const { session, owner } = await generated();
    const booking = await client.db.$client.connect();
    try {
      await booking.query('BEGIN');
      await booking.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [
        session.id,
      ]);
      const pending = editCapacity(owner, {
        sessionId: session.id,
        allocation: 2,
        expectedVersion: 1,
      });
      await waitUntilBlocked(client.db.$client, {
        blockedBy: await backendPid(booking),
      });
      await booking.query('UPDATE sessions SET seats_sold = 3 WHERE id = $1', [
        session.id,
      ]);
      await booking.query('COMMIT');

      await expect(pending).resolves.toEqual({
        ok: false,
        reason: 'below_sold_and_held',
        seatsSold: 3,
        heldSeats: 0,
      });
    } finally {
      booking.release();
    }
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      seatsSold: 3,
    });
  });

  /** Holds the row lock, starts the edit, runs `change` once the edit waits, then commits. */
  async function editWhileLocked(
    caller: Caller,
    sessionId: string,
    edit: { allocation: number; expectedVersion: number },
    change: (held: PoolClient) => Promise<unknown>,
  ) {
    const held = await client.db.$client.connect();
    try {
      await held.query('BEGIN');
      await held.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [
        sessionId,
      ]);
      const holderPid = await backendPid(held);
      const pending = sessionData
        .updateSessionAllocation(caller, { sessionId, ...edit }, earlyNow)
        .then(
          (value) => ({ value }) as const,
          (error: unknown) => ({ error }) as const,
        );
      await waitUntilBlocked(client.db.$client, { blockedBy: holderPid });
      await change(held);
      await held.query('COMMIT');
      return await pending;
    } finally {
      held.release();
    }
  }

  it('checks the caller again under the lock, so an owner who waited loses an edit the session no longer allows', async () => {
    const { session, owner } = await generated();

    const outcome = await editWhileLocked(
      owner,
      session.id,
      { allocation: 12, expectedVersion: 1 },
      (held) =>
        held.query(
          "UPDATE sessions SET source = 'allocation', status = 'cancelled', cancel_reason = 'host' WHERE id = $1",
          [session.id],
        ),
    );

    expect('error' in outcome && outcome.error).toBeInstanceOf(ForbiddenError);
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      version: 1,
      source: 'allocation',
      status: 'cancelled',
    });
  });

  it('checks status, then version, then seats sold under the lock', async () => {
    const { session, owner } = await generated();
    await client.db
      .update(sessions)
      .set({ seatsSold: 5, version: 3 })
      .where(eq(sessions.id, session.id));
    const staleAndBelowSold = { allocation: 2, expectedVersion: 1 };

    const cancelled = await editWhileLocked(
      owner,
      session.id,
      staleAndBelowSold,
      (held) =>
        held.query(
          "UPDATE sessions SET status = 'cancelled', cancel_reason = 'host' WHERE id = $1",
          [session.id],
        ),
    );
    await client.db
      .update(sessions)
      .set({ status: 'scheduled', cancelReason: null })
      .where(eq(sessions.id, session.id));
    const stale = await editCapacity(owner, {
      sessionId: session.id,
      ...staleAndBelowSold,
    });

    expect(cancelled).toEqual({
      value: { ok: false, reason: 'not_scheduled' },
    });
    expect(stale).toEqual({ ok: false, reason: 'version_conflict' });
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      seatsSold: 5,
      version: 3,
    });
  });
});
