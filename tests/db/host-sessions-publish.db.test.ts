import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/server/auth/caller';
import { hosts, priceOptions } from '@/server/db/schema';
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

const cache = vi.hoisted(() => ({
  updateTag: vi.fn<(tag: string) => void>(),
  revalidateTag: vi.fn<(tag: string, profile: string) => void>(),
}));
vi.mock('next/cache', () => cache);

// Behaviours under test, one per decision, branch or risk:
// - publishing a week generates the Ramble slots for Monday to Sunday and nothing outside it, is
//   safe to repeat, never touches an allocation slot, counts dates already past, writes nothing for
//   a host zone that is not usable or when a later slot fails, and refuses a week past the horizon
// - the week read holds this host's sessions from Monday 00:00 to the next Monday 00:00 in the host's
//   zone, with cancelled ones, the adult price and the host's experiences
// - publishing and reading the week are the host owner's alone

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

const {
  setup,
  createTemplate,
  sessionsOf,
  insertSession,
  insertExperience,
  countSessions,
} = sessionsFixtures(
  () => client,
  () => sessionData,
);

const beforeTheDay = new Date('2026-06-01T00:00:00Z');

describe('publishWeek', () => {
  it('generates the Ramble slots for the week and no other week, and is safe to repeat', async () => {
    const { experience, owner, host } = await setup();
    const slot = await createTemplate(experience.id);

    const first = await sessionData.publishWeek(
      owner,
      host.id,
      '2026-06-03',
      earlyNow,
    );
    const again = await sessionData.publishWeek(
      owner,
      host.id,
      '2026-06-01',
      earlyNow,
    );

    expect(first).toEqual({
      ok: true,
      templates: 1,
      created: 1,
      alreadyExisted: 0,
      inThePast: 0,
    });
    expect(again).toMatchObject({ ok: true, created: 0, alreadyExisted: 1 });
    expect((await sessionsOf(slot.id)).map((row) => row.localDate)).toEqual([
      '2026-06-06',
    ]);
  });

  it('leaves an allocation slot to ops', async () => {
    const { experience, owner, host } = await setup();
    await createTemplate(experience.id);
    const allocation = await createTemplate(experience.id, {
      source: 'allocation',
      startTime: '11:00',
    });

    const result = await sessionData.publishWeek(
      owner,
      host.id,
      '2026-06-01',
      earlyNow,
    );

    expect(result).toMatchObject({ ok: true, templates: 1, created: 1 });
    expect(await sessionsOf(allocation.id)).toHaveLength(0);
  });

  it('counts a date already past and creates nothing for it', async () => {
    const { experience, owner, host } = await setup();
    await createTemplate(experience.id, { weekday: 1 });

    const result = await sessionData.publishWeek(
      owner,
      host.id,
      '2026-06-01',
      new Date('2026-06-03T00:00:00Z'),
    );

    expect(result).toEqual({
      ok: true,
      templates: 1,
      created: 0,
      alreadyExisted: 0,
      inThePast: 1,
    });
  });

  it('says there is nothing to publish for a host with no slots', async () => {
    const { owner, host } = await setup();

    expect(
      await sessionData.publishWeek(owner, host.id, '2026-06-01', earlyNow),
    ).toEqual({
      ok: true,
      templates: 0,
      created: 0,
      alreadyExisted: 0,
      inThePast: 0,
    });
  });

  it('writes nothing for a host zone that is not usable, even for slots before the bad one', async () => {
    const { host, experience, owner } = await setup();
    await createTemplate(experience.id);
    await createTemplate(experience.id, { startTime: '12:00' });
    await client.db
      .update(hosts)
      .set({ timeZone: 'Nowhere/Land' })
      .where(eq(hosts.id, host.id));

    expect(
      await sessionData.publishWeek(owner, host.id, '2026-06-01', earlyNow),
    ).toEqual({ ok: false, reason: 'invalid_time_zone' });
    expect(await countSessions(experience.id)).toBe(0);
  });

  it('rolls back every slot when a later one fails, and invalidates nothing', async () => {
    const { host, experience, owner } = await setup();
    const second = await insertExperience(host.id);
    // Slots run in experience order, so the one that fails is the one that runs second.
    const [first, last] =
      experience.id < second.id ? [experience, second] : [second, experience];
    await createTemplate(first.id);
    await createTemplate(last.id);
    const name = `refuse_${last.id.replaceAll('-', '')}`;
    await client.db.execute(
      sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger AS $$
        BEGIN
          IF NEW.experience_id = '${last.id}' THEN
            RAISE EXCEPTION 'refused for the test';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`),
    );
    await client.db.execute(
      sql.raw(
        `CREATE TRIGGER ${name} BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      ),
    );
    cache.updateTag.mockClear();

    await expect(
      sessionData.publishWeek(owner, host.id, '2026-06-01', earlyNow),
    ).rejects.toThrow();

    expect(await countSessions(first.id)).toBe(0);
    expect(await countSessions(last.id)).toBe(0);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('refuses a week that ends past the horizon', async () => {
    const { experience, owner, host } = await setup();
    await createTemplate(experience.id);

    expect(
      await sessionData.publishWeek(owner, host.id, '2028-01-03', earlyNow),
    ).toEqual({ ok: false, reason: 'beyond_horizon' });
  });

  it('is the host owner’s alone: another host’s owner, ops and a guest are refused', async () => {
    const { host } = await setup();
    const other = ownerOf((await setup()).host.id);

    for (const caller of [other, ops, guest]) {
      await expect(
        sessionData.publishWeek(caller, host.id, '2026-06-01', earlyNow),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe('readHostWeek', () => {
  it('reads this host’s sessions from Monday midnight to the next Monday midnight in the host’s zone', async () => {
    const { experience, owner, host } = await setup();
    await client.db.insert(priceOptions).values({
      experienceId: experience.id,
      kind: 'adult',
      priceMinor: 7500,
      usesSpace: true,
    });
    const at = (startsAt: string, extra = {}) =>
      insertSession(experience.id, {
        startsAt: new Date(startsAt),
        endsAt: new Date(new Date(startsAt).getTime() + 3_600_000),
        ...extra,
      });
    // Monday 2026-06-01 00:00 New York is 04:00Z; Monday 2026-06-08 00:00 is 04:00Z.
    await at('2026-06-01T03:59:00Z');
    const monday = await at('2026-06-01T04:00:00Z');
    const cancelled = await at('2026-06-05T14:00:00Z', {
      status: 'cancelled',
      cancelReason: 'host',
    });
    const sunday = await at('2026-06-08T03:59:00Z');
    await at('2026-06-08T04:00:00Z');
    const stranger = await setup();
    await insertSession(stranger.experience.id, {
      startsAt: new Date('2026-06-02T14:00:00Z'),
      endsAt: new Date('2026-06-02T15:00:00Z'),
    });

    const week = await sessionData.readHostWeek(
      owner,
      host.id,
      '2026-06-03',
      new Date('2026-06-02T00:00:00Z'),
    );

    expect(week).toMatchObject({
      hostName: host.name,
      timeZone: 'America/New_York',
      weekStart: '2026-06-01',
      experiences: [{ id: experience.id, name: experience.name }],
    });
    expect(week?.sessions.map((row) => row.id)).toEqual([
      monday.id,
      cancelled.id,
      sunday.id,
    ]);
    expect(week?.sessions.map((row) => row.status)).toEqual([
      'scheduled',
      'cancelled',
      'scheduled',
    ]);
    expect(week?.sessions[0]?.adultPriceMinor).toBe(7500);
  });

  it('reads this week when the address names one outside the limits', async () => {
    const { owner, host } = await setup();

    const week = await sessionData.readHostWeek(
      owner,
      host.id,
      '1999-01-01',
      new Date('2026-06-03T12:00:00Z'),
    );

    expect(week?.weekStart).toBe('2026-06-01');
  });

  it('is the host owner’s alone, and null for a host that is not there', async () => {
    const { host } = await setup();
    const other = ownerOf((await setup()).host.id);

    for (const caller of [other, ops, guest]) {
      await expect(
        sessionData.readHostWeek(caller, host.id, undefined, beforeTheDay),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const gone = '11111111-1111-4111-8111-111111111111';
    await expect(
      sessionData.readHostWeek(ownerOf(gone), gone, undefined, beforeTheDay),
    ).resolves.toBeNull();
  });
});
