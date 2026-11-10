import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { hosts, sessions } from '@/server/db/schema';
import { ops, sessionsFixtures } from './sessionsFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - a first run fills the 12 weeks ahead for every template, whoever owns it, and names the experiences that gained sessions
// - a second run at the same instant creates nothing and leaves the stored rows as they were
// - a later run adds only the dates that came into the window, and an edited session is not rebuilt
// - a template that spans a daylight saving change keeps its local start time while the UTC start moves an hour
// - a template with an unusable host zone is skipped and the rest carry on

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

const { setup, createTemplate, sessionsOf } = sessionsFixtures(
  () => client,
  () => sessionData,
);

const localStart = (startsAt: Date, zone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(startsAt);

// The tests share one database, so a run also extends the templates of the tests before it; each test
// reads its own template's rows, and the totals it asserts are ones the earlier tests leave alone.
describe('extendSessionHorizon', () => {
  // Saturday 10:00 in New York; the window from 2026-02-20 reaches 2026-05-15 and crosses the 8 March change.
  const now = new Date('2026-02-20T12:00:00Z');

  it('fills twelve weeks ahead for a template and names its experience', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);

    const result = await sessionData.extendSessionHorizon(now);

    expect(result.created).toBeGreaterThanOrEqual(12);
    expect(result.experienceIds).toContain(experience.id);
    const stored = await sessionsOf(template.id);
    expect(stored).toHaveLength(12);
    expect(stored[0]?.localDate).toBe('2026-02-21');
    expect(stored[11]?.localDate).toBe('2026-05-09');
  });

  it('creates nothing and changes nothing when run twice at the same instant', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);
    await sessionData.extendSessionHorizon(now);
    const before = await sessionsOf(template.id);

    const second = await sessionData.extendSessionHorizon(now);

    expect(second.created).toBe(0);
    expect(second.experienceIds).toEqual([]);
    expect(await sessionsOf(template.id)).toEqual(before);
  });

  it('adds only the dates that came into the window on a later run, and keeps an edited session', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);
    await sessionData.extendSessionHorizon(now);
    const [first] = await sessionsOf(template.id);
    if (!first) throw new Error('expected a session');
    await client.db
      .update(sessions)
      .set({ allocation: 3 })
      .where(eq(sessions.id, first.id));

    await sessionData.extendSessionHorizon(new Date('2026-02-27T12:00:00Z'));

    const stored = await sessionsOf(template.id);
    expect(stored).toHaveLength(13);
    expect(stored[12]?.localDate).toBe('2026-05-16');
    expect(stored[0]).toMatchObject({ id: first.id, allocation: 3 });
  });

  it('keeps the local start time across the spring-forward change', async () => {
    const zone = 'America/New_York';
    const { experience } = await setup(zone);
    const template = await createTemplate(experience.id);

    await sessionData.extendSessionHorizon(now);

    const stored = await sessionsOf(template.id);
    const byDate = new Map(stored.map((row) => [row.localDate, row.startsAt]));
    expect(byDate.get('2026-03-07')).toEqual(new Date('2026-03-07T15:00:00Z'));
    expect(byDate.get('2026-03-14')).toEqual(new Date('2026-03-14T14:00:00Z'));
    expect(
      new Set(stored.map((row) => localStart(row.startsAt, zone))),
    ).toEqual(new Set(['10:00']));
  });

  it('keeps the local start time across the fall-back change', async () => {
    const zone = 'Europe/London';
    const { experience } = await setup(zone);
    const template = await createTemplate(experience.id);

    await sessionData.extendSessionHorizon(new Date('2026-10-10T12:00:00Z'));

    const stored = await sessionsOf(template.id);
    const byDate = new Map(stored.map((row) => [row.localDate, row.startsAt]));
    expect(byDate.get('2026-10-24')).toEqual(new Date('2026-10-24T09:00:00Z'));
    expect(byDate.get('2026-10-31')).toEqual(new Date('2026-10-31T10:00:00Z'));
    expect(
      new Set(stored.map((row) => localStart(row.startsAt, zone))),
    ).toEqual(new Set(['10:00']));
  });

  it('skips a template whose host zone is unusable and extends the rest', async () => {
    const broken = await setup();
    await createTemplate(broken.experience.id);
    await client.db
      .update(hosts)
      .set({ timeZone: 'Not/AZone' })
      .where(eq(hosts.id, broken.host.id));
    const healthy = await setup();
    const template = await createTemplate(healthy.experience.id, {}, ops);

    const result = await sessionData.extendSessionHorizon(now);

    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.experienceIds).toContain(healthy.experience.id);
    expect(await sessionsOf(template.id)).toHaveLength(12);
  });
});
