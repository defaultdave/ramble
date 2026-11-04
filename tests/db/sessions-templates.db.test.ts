import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { maxAllocation } from '@/lib/sessions';
import { anonymousCaller, ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { sessionTemplates } from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import {
  admin,
  guest,
  ops,
  ownerOf,
  saturdayTenAm,
  sessionsFixtures,
} from './sessionsFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - a template is created by the experience's host owner (Ramble source) or by ops and admin
//   (either source); an allocation template is refused for a host owner; another host's owner,
//   a guest and an anonymous caller are refused; a refusal writes nothing
// - a repeat slot is reported and leaves the first template as it was; an unknown experience is reported

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

const { setup, createTemplate } = sessionsFixtures(
  () => client,
  () => sessionData,
);

describe('createSessionTemplate', () => {
  it('lets the host owner create a Ramble template, stored with zero seconds', async () => {
    const { experience, owner } = await setup();

    const result = await sessionData.createSessionTemplate(owner, {
      experienceId: experience.id,
      ...saturdayTenAm,
    });

    expect(result).toMatchObject({
      ok: true,
      template: {
        experienceId: experience.id,
        weekday: 6,
        startTime: '10:00:00',
        durationMinutes: 120,
        allocation: 8,
        source: 'ramble',
      },
    });
  });

  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s create an allocation template', async (_name, caller) => {
    const { experience } = await setup();

    const result = await sessionData.createSessionTemplate(caller, {
      experienceId: experience.id,
      ...saturdayTenAm,
      allocation: 6,
      source: 'allocation',
    });

    expect(result).toMatchObject({
      ok: true,
      template: { source: 'allocation', allocation: 6 },
    });
  });

  it('refuses an allocation template for the host owner, and writes nothing', async () => {
    const { experience, owner } = await setup();

    await expect(
      sessionData.createSessionTemplate(owner, {
        experienceId: experience.id,
        ...saturdayTenAm,
        source: 'allocation',
      }),
    ).rejects.toThrow(ForbiddenError);

    const [row] = await client.db
      .select({ total: count() })
      .from(sessionTemplates)
      .where(eq(sessionTemplates.experienceId, experience.id));
    expect(row?.total).toBe(0);
  });

  it.each([
    ['the owner of another host', async () => ownerOf((await setup()).host.id)],
    ['a guest', () => Promise.resolve(guest)],
    ['an anonymous caller', () => Promise.resolve(anonymousCaller)],
    [
      'host staff',
      async () =>
        testCaller({
          roles: [Role.HostStaff],
          hostIds: [(await setup()).host.id],
        }),
    ],
  ])('refuses %s', async (_name, getCaller) => {
    const { experience } = await setup();

    await expect(
      sessionData.createSessionTemplate(await getCaller(), {
        experienceId: experience.id,
        ...saturdayTenAm,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('reports a repeat slot and leaves the first template as it was', async () => {
    const { experience, owner } = await setup();
    const first = await createTemplate(experience.id, {}, owner);

    const result = await sessionData.createSessionTemplate(owner, {
      experienceId: experience.id,
      ...saturdayTenAm,
      allocation: 1,
      durationMinutes: 30,
    });

    expect(result).toEqual({ ok: false, reason: 'duplicate_slot' });
    const [stored] = await client.db
      .select()
      .from(sessionTemplates)
      .where(eq(sessionTemplates.id, first.id));
    expect(stored).toMatchObject({ allocation: 8, durationMinutes: 120 });
  });

  it('reports an experience that does not exist to staff', async () => {
    const result = await sessionData.createSessionTemplate(ops, {
      experienceId: '11111111-1111-4111-8111-111111111111',
      ...saturdayTenAm,
    });

    expect(result).toEqual({ ok: false, reason: 'experience_not_found' });
  });

  it.each([
    ['a host owner', () => ownerOf('22222222-2222-4222-8222-222222222222')],
    ['a guest', () => guest],
    ['an anonymous caller', () => anonymousCaller],
  ])(
    'refuses %s for an experience that does not exist',
    async (_name, getCaller) => {
      await expect(
        sessionData.createSessionTemplate(getCaller(), {
          experienceId: '11111111-1111-4111-8111-111111111111',
          ...saturdayTenAm,
        }),
      ).rejects.toThrow(ForbiddenError);
    },
  );

  it.each([
    ['a weekday of 7', { weekday: 7 }],
    ['a start time of 24:00', { startTime: '24:00' }],
    ['an external source', { source: 'external' }],
    ['an allocation over the limit', { allocation: maxAllocation + 1 }],
  ])('throws for %s', async (_name, override) => {
    const { experience } = await setup();

    await expect(
      sessionData.createSessionTemplate(ops, {
        experienceId: experience.id,
        ...saturdayTenAm,
        ...override,
      } as never),
    ).rejects.toThrow();
  });
});
