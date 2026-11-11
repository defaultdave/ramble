import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { maxAllocation } from '@/lib/sessions';
import {
  anonymousCaller,
  ForbiddenError,
  type Caller,
} from '@/server/auth/caller';
import { sessions } from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import {
  admin,
  earlyNow,
  guest,
  ops,
  ownerOf,
  sessionsFixtures,
} from './sessionsFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - an allocation session's capacity is ops only; the same refusals apply to the edit
// - a missing template, experience or session is reported to staff and refused to everyone else,
//   so it cannot be told from another host's row; the capacity edit refuses a caller without
//   waiting for the row lock
// - a capacity edit on a cancelled or completed session is refused, and nothing changes

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

const { setup, generated, stored } = sessionsFixtures(
  () => client,
  () => sessionData,
);

/** The sessions here are in June 2026, so every edit is made on a day before them. */
const editCapacity = (
  caller: Caller,
  input: Parameters<typeof sessionData.updateSessionAllocation>[1],
) => sessionData.updateSessionAllocation(caller, input, earlyNow);

describe('updateSessionAllocation', () => {
  it('gives a caller who is not staff the same refusal for a missing row, another host and a staff-only row', async () => {
    const { session } = await generated('allocation');
    const other = ownerOf((await setup()).host.id);
    const missing = '11111111-1111-4111-8111-111111111111';
    const refusals = await Promise.all(
      [
        [other, missing],
        [other, session.id],
        [guest, missing],
        [guest, session.id],
        [anonymousCaller, session.id],
      ].map(async ([caller, sessionId]) => {
        try {
          await editCapacity(caller as Caller, {
            sessionId: sessionId as string,
            allocation: 4,
            expectedVersion: 1,
          });
          return 'not refused';
        } catch (error) {
          return error instanceof ForbiddenError
            ? `${error.name}: ${error.message}`
            : 'other error';
        }
      }),
    );

    expect(new Set(refusals)).toEqual(
      new Set([
        'ForbiddenError: Caller may not act as host_owner on this resource',
      ]),
    );
  });

  it('gives the owner of the host the same refusal on its own staff-only session', async () => {
    const { session, owner } = await generated('allocation');
    const other = ownerOf((await setup()).host.id);
    const message = async (caller: Caller) => {
      try {
        await editCapacity(caller, {
          sessionId: session.id,
          allocation: 4,
          expectedVersion: 1,
        });
        return 'not refused';
      } catch (error) {
        return error instanceof Error ? error.message : 'other error';
      }
    };

    expect(await message(owner)).toBe(await message(other));
  });

  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s edit an allocation session', async (_name, caller) => {
    const { session } = await generated('allocation');

    const result = await editCapacity(caller, {
      sessionId: session.id,
      allocation: 10,
      expectedVersion: 1,
    });

    expect(result).toMatchObject({ ok: true, session: { allocation: 10 } });
  });

  it('refuses the host owner on an allocation session', async () => {
    const { session, owner } = await generated('allocation');

    await expect(
      editCapacity(owner, {
        sessionId: session.id,
        allocation: 10,
        expectedVersion: 1,
      }),
    ).rejects.toThrow(ForbiddenError);
    expect((await stored(session.id)).allocation).toBe(8);
  });

  it.each([
    ['the owner of another host', async () => ownerOf((await setup()).host.id)],
    ['a guest', () => Promise.resolve(guest)],
    ['an anonymous caller', () => Promise.resolve(anonymousCaller)],
  ])('refuses %s, and changes nothing', async (_name, getCaller) => {
    const { session } = await generated();

    await expect(
      editCapacity(await getCaller(), {
        sessionId: session.id,
        allocation: 10,
        expectedVersion: 1,
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      version: 1,
    });
  });

  it('reports a session that does not exist', async () => {
    const result = await editCapacity(ops, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      allocation: 4,
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, reason: 'session_not_found' });
  });

  it.each([
    ['a host owner', () => ownerOf('22222222-2222-4222-8222-222222222222')],
    ['a guest', () => guest],
    ['an anonymous caller', () => anonymousCaller],
  ])(
    'refuses %s for a session that does not exist',
    async (_name, getCaller) => {
      await expect(
        editCapacity(getCaller(), {
          sessionId: '11111111-1111-4111-8111-111111111111',
          allocation: 4,
          expectedVersion: 1,
        }),
      ).rejects.toThrow(ForbiddenError);
    },
  );

  it.each([
    ['cancelled', { status: 'cancelled', cancelReason: 'weather' }],
    ['completed', { status: 'completed' }],
  ] as const)(
    'refuses an edit on a %s session, and changes nothing',
    async (_name, change) => {
      const { session, owner } = await generated();
      await client.db
        .update(sessions)
        .set(change)
        .where(eq(sessions.id, session.id));

      const result = await editCapacity(owner, {
        sessionId: session.id,
        allocation: 4,
        expectedVersion: 1,
      });

      expect(result).toEqual({ ok: false, reason: 'not_scheduled' });
      expect(await stored(session.id)).toMatchObject({
        allocation: 8,
        version: 1,
        status: change.status,
      });
    },
  );

  it('refuses a caller who may not act without waiting for the row lock', async () => {
    const { session } = await generated();
    const holder = await client.db.$client.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [
        session.id,
      ]);

      await expect(
        editCapacity(guest, {
          sessionId: session.id,
          allocation: 4,
          expectedVersion: 1,
        }),
      ).rejects.toThrow(ForbiddenError);
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }
  });

  it.each([
    ['a negative capacity', { allocation: -1 }],
    ['a capacity over the limit', { allocation: maxAllocation + 1 }],
    ['a malformed session id', { sessionId: 'nope' }],
    ['a version of 0', { expectedVersion: 0 }],
  ])('throws for %s, and changes nothing', async (_name, override) => {
    const { session } = await generated();

    await expect(
      editCapacity(ops, {
        sessionId: session.id,
        allocation: 4,
        expectedVersion: 1,
        ...override,
      }),
    ).rejects.toThrow(ZodError);
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      version: 1,
    });
  });
});
