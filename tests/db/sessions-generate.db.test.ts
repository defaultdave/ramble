import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { anonymousCaller, ForbiddenError } from '@/server/auth/caller';
import { hosts, sessions } from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import {
  earlyNow,
  guest,
  ops,
  ownerOf,
  sessionsFixtures,
} from './sessionsFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - generation lists the weekday's dates in the host's zone with the template's allocation and
//   source, holds the wall time across a clock change, and records the zone it used
// - generation is idempotent: a rerun, an overlapping range, two runs at once, and a changed host
//   zone create no duplicate; an edited or cancelled session is not rebuilt
// - generation skips dates that start at or before now, and reports a bad host zone, a missing
//   template, and a refused caller without writing

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

const { setup, createTemplate, sessionsOf, countSessions } = sessionsFixtures(
  () => client,
  () => sessionData,
);

describe('generateSessions', () => {
  const range = { fromDate: '2026-06-06', toDate: '2026-06-27' };

  it('creates a session for each matching date in the host zone, with the template values', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);

    const result = await sessionData.generateSessions(
      owner,
      { templateId: template.id, ...range },
      earlyNow,
    );

    expect(result).toMatchObject({
      ok: true,
      experienceId: experience.id,
      alreadyExisted: 0,
      inThePast: 0,
    });
    const stored = await sessionsOf(template.id);
    expect(stored.map((row) => row.localDate)).toEqual([
      '2026-06-06',
      '2026-06-13',
      '2026-06-20',
      '2026-06-27',
    ]);
    expect(stored[0]).toMatchObject({
      experienceId: experience.id,
      startsAt: new Date('2026-06-06T14:00:00Z'),
      endsAt: new Date('2026-06-06T16:00:00Z'),
      timeZone: 'America/New_York',
      allocation: 8,
      seatsSold: 0,
      status: 'scheduled',
      source: 'ramble',
      cancelReason: null,
      version: 1,
    });
    expect(result.ok && result.created).toHaveLength(4);
  });

  it('holds the wall time across the spring-forward change', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);

    await sessionData.generateSessions(
      owner,
      { templateId: template.id, fromDate: '2026-03-01', toDate: '2026-03-21' },
      earlyNow,
    );

    const starts = (await sessionsOf(template.id)).map((row) =>
      row.startsAt.toISOString(),
    );
    expect(starts).toEqual([
      '2026-03-07T15:00:00.000Z',
      '2026-03-14T14:00:00.000Z',
      '2026-03-21T14:00:00.000Z',
    ]);
  });

  it('uses the host zone, not the server zone', async () => {
    const { experience, owner } = await setup('Europe/London');
    const template = await createTemplate(experience.id, {}, owner);

    await sessionData.generateSessions(
      owner,
      { templateId: template.id, ...range },
      earlyNow,
    );

    const [first] = await sessionsOf(template.id);
    expect(first).toMatchObject({
      startsAt: new Date('2026-06-06T09:00:00Z'),
      timeZone: 'Europe/London',
    });
  });

  it('creates nothing new on a rerun over the same range', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);
    const input = { templateId: template.id, ...range };
    await sessionData.generateSessions(owner, input, earlyNow);
    const before = await sessionsOf(template.id);

    const second = await sessionData.generateSessions(owner, input, earlyNow);

    expect(second).toMatchObject({ ok: true, created: [], alreadyExisted: 4 });
    expect(await sessionsOf(template.id)).toEqual(before);
  });

  it('creates only the missing dates over an overlapping range', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);
    await sessionData.generateSessions(
      owner,
      { templateId: template.id, fromDate: '2026-06-06', toDate: '2026-06-20' },
      earlyNow,
    );

    const result = await sessionData.generateSessions(
      owner,
      { templateId: template.id, fromDate: '2026-06-13', toDate: '2026-07-04' },
      earlyNow,
    );

    expect(result.ok && result.created.map((row) => row.localDate)).toEqual([
      '2026-06-27',
      '2026-07-04',
    ]);
    expect(result).toMatchObject({ alreadyExisted: 2 });
    expect(await sessionsOf(template.id)).toHaveLength(5);
  });

  it('creates each date once when two runs overlap in time', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);
    const input = { templateId: template.id, ...range };

    const results = await Promise.all([
      sessionData.generateSessions(owner, input, earlyNow),
      sessionData.generateSessions(owner, input, earlyNow),
      sessionData.generateSessions(owner, input, earlyNow),
    ]);

    const created = results.reduce(
      (total, result) => total + (result.ok ? result.created.length : 0),
      0,
    );
    expect(created).toBe(4);
    expect(await sessionsOf(template.id)).toHaveLength(4);
  });

  it('creates no duplicate when the host zone changed after the first run', async () => {
    const { host, experience, owner } = await setup('America/New_York');
    const template = await createTemplate(experience.id, {}, owner);
    const input = { templateId: template.id, ...range };
    await sessionData.generateSessions(owner, input, earlyNow);
    await client.db
      .update(hosts)
      .set({ timeZone: 'Europe/London' })
      .where(eq(hosts.id, host.id));

    const second = await sessionData.generateSessions(owner, input, earlyNow);

    expect(second).toMatchObject({ ok: true, created: [], alreadyExisted: 4 });
    const stored = await sessionsOf(template.id);
    expect(stored).toHaveLength(4);
    expect(stored[0]?.timeZone).toBe('America/New_York');
  });

  it('does not rebuild an edited session or a cancelled one', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);
    const input = { templateId: template.id, ...range };
    await sessionData.generateSessions(owner, input, earlyNow);
    const [edited, cancelled] = await sessionsOf(template.id);
    if (!edited || !cancelled) throw new Error('expected sessions');
    await client.db
      .update(sessions)
      .set({ allocation: 3, version: 2 })
      .where(eq(sessions.id, edited.id));
    await client.db
      .update(sessions)
      .set({ status: 'cancelled', cancelReason: 'host' })
      .where(eq(sessions.id, cancelled.id));

    const second = await sessionData.generateSessions(owner, input, earlyNow);

    expect(second).toMatchObject({ ok: true, created: [], alreadyExisted: 4 });
    const stored = await sessionsOf(template.id);
    expect(stored).toHaveLength(4);
    expect(stored[0]).toMatchObject({ allocation: 3, version: 2 });
    expect(stored[1]).toMatchObject({
      status: 'cancelled',
      cancelReason: 'host',
    });
  });

  it('skips dates that start at or before now and reports how many', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);

    const result = await sessionData.generateSessions(
      owner,
      { templateId: template.id, ...range },
      new Date('2026-06-13T14:00:00Z'),
    );

    expect(result).toMatchObject({ ok: true, inThePast: 2, alreadyExisted: 0 });
    expect((await sessionsOf(template.id)).map((row) => row.localDate)).toEqual(
      ['2026-06-20', '2026-06-27'],
    );
  });

  it('writes nothing and reports when every date is in the past', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);

    const result = await sessionData.generateSessions(
      owner,
      { templateId: template.id, ...range },
      new Date('2027-01-01T00:00:00Z'),
    );

    expect(result).toMatchObject({ ok: true, created: [], inThePast: 4 });
    expect(await countSessions(experience.id)).toBe(0);
  });

  it('generates allocation sessions for ops with the allocation as capacity', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id, {
      source: 'allocation',
      allocation: 6,
    });

    const result = await sessionData.generateSessions(
      ops,
      { templateId: template.id, ...range },
      earlyNow,
    );

    expect(result).toMatchObject({ ok: true });
    const stored = await sessionsOf(template.id);
    expect(stored).toHaveLength(4);
    expect(stored.every((row) => row.source === 'allocation')).toBe(true);
    expect(stored.every((row) => row.allocation === 6)).toBe(true);
  });

  it('refuses the host owner for an allocation template, and writes nothing', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {
      source: 'allocation',
    });

    await expect(
      sessionData.generateSessions(
        owner,
        { templateId: template.id, ...range },
        earlyNow,
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(await countSessions(experience.id)).toBe(0);
  });

  it.each([
    ['the owner of another host', async () => ownerOf((await setup()).host.id)],
    ['a guest', () => Promise.resolve(guest)],
    ['an anonymous caller', () => Promise.resolve(anonymousCaller)],
  ])('refuses %s, and writes nothing', async (_name, getCaller) => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);

    await expect(
      sessionData.generateSessions(
        await getCaller(),
        { templateId: template.id, ...range },
        earlyNow,
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(await countSessions(experience.id)).toBe(0);
  });

  it.each([
    ['an abbreviation', 'EST'],
    ['a name Intl does not know', 'Nowhere/Land'],
  ])(
    'reports a host zone that is %s, and writes nothing',
    async (_name, zone) => {
      const { host, experience, owner } = await setup();
      const template = await createTemplate(experience.id, {}, owner);
      await client.db
        .update(hosts)
        .set({ timeZone: zone })
        .where(eq(hosts.id, host.id));

      const result = await sessionData.generateSessions(
        owner,
        { templateId: template.id, ...range },
        earlyNow,
      );

      expect(result).toEqual({ ok: false, reason: 'invalid_time_zone' });
      expect(await countSessions(experience.id)).toBe(0);
    },
  );

  it('reports a template that does not exist', async () => {
    const result = await sessionData.generateSessions(
      ops,
      {
        templateId: '11111111-1111-4111-8111-111111111111',
        ...range,
      },
      earlyNow,
    );

    expect(result).toEqual({ ok: false, reason: 'template_not_found' });
  });

  it.each([
    ['a host owner', () => ownerOf('22222222-2222-4222-8222-222222222222')],
    ['a guest', () => guest],
    ['an anonymous caller', () => anonymousCaller],
  ])(
    'refuses %s for a template that does not exist',
    async (_name, getCaller) => {
      await expect(
        sessionData.generateSessions(
          getCaller(),
          { templateId: '11111111-1111-4111-8111-111111111111', ...range },
          earlyNow,
        ),
      ).rejects.toThrow(ForbiddenError);
    },
  );
});
