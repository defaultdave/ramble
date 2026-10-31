import { updateTag } from 'next/cache';
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  browseDays,
  browseWindowDays,
  nextBrowseDay,
} from '@/lib/pages/browse';
import { upcomingWindow } from '@/lib/sessionWindow';
import { noFilters } from '@/lib/filters';
import { minuteAsOf, msPerDay } from '@/lib/time';
import {
  coverage,
  coverageGaps,
  evaluateCoverage,
  type ProbeKey,
} from '@/lib/seed/coverage';
import { SeedStepError } from '@/lib/seed/decide';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { curated } from '@/lib/seed/fixtures';
import { planSessions } from '@/lib/seed/plan';
import { maxScaleExperiences } from '@/lib/seed/args';
import { experienceId, hostNotificationEmail, hostRow } from '@/lib/seed/rows';
import { generateScaleFixtures } from '@/lib/seed/scale';
import { snapshotFromFixtures } from '@/lib/seed/snapshot';
import {
  categories,
  collectionItems,
  collections,
  experiences,
  homeModules,
  hosts,
  legalDocuments,
  neighborhoods,
  pages,
  priceOptions,
  sessionTemplates,
  sessions,
  settings,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - a seed run fills a migrated database with the curated set: categories, neighborhoods, hosts,
//   experiences, prices, templates, sessions, legal documents, collections, the home page, page copy
// - every probe of the coverage matrix holds on what the database holds, and the sessions it holds
//   are the ones the plan says, with the planned seats sold
// - the zero-results state (S2) holds through browse's own query: kids in Williamsburg return nothing on
//   every weeknight of browse's window and the wheel class on a weekend
// - browse with no filters lists every seeded experience a guest can see, whatever the clock says, because
//   no session decides it; a day with no session left lists none, that is the only way a seeded
//   browse page reads empty, and the next listed day after it has experiences
// - the guest reads the app will use parse the seeded rows and show what a guest may see: live and
//   guide-only experiences, published Picks without the paused entry, the gift guide, six home
//   modules in order, copy for every category and neighborhood, the published legal documents
// - legal documents are inserted as drafts and published through the publish path; the waiver the
//   kayak names is that published version
// - a rerun is idempotent: no row is added, no id changes, no legal version is added, and a
//   created-at stays; a booking that sold more than the plan is not lowered
// - a document left as a draft by a stopped run is published by the next run, not duplicated
// - every seeded host has the address bookings@<slug>.example, a rerun fills a host whose address
//   is null, and the database CHECK accepts the address of the longest slug the seed can write
// - the settings row, and so the tax rate the settings migration seeds, is not touched
// - the scale fixture writes the requested number of experiences and hosts, passes the scale probe,
//   repeats exactly on a second run, and keeps the zero-results state true
// - a stored collection of another kind under a seeded slug stops the seed with a seed message
// - the seed and the snapshot read refuse a caller who is not ops (guest, host owner, no roles) before
//   any row is read or written
// - the data layer's invalidation is called with tags (the stub the script installs stands in outside Next)

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let runner: typeof import('@/server/db/seed/run');
let reader: typeof import('@/server/db/seed/read');
let seedCaller: typeof import('@/server/db/seed/caller').seedCaller;
let catalogReads: typeof import('@/server/db/catalog');
let browseReads: typeof import('@/server/db/browse');
let editorialReads: typeof import('@/server/db/editorial');
let legalReads: typeof import('@/server/db/legal');
let settingsReads: typeof import('@/server/db/settings');

const now = new Date('2026-10-28T15:00:00Z');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  runner = await import('@/server/db/seed/run');
  reader = await import('@/server/db/seed/read');
  ({ seedCaller } = await import('@/server/db/seed/caller'));
  catalogReads = await import('@/server/db/catalog');
  browseReads = await import('@/server/db/browse');
  editorialReads = await import('@/server/db/editorial');
  legalReads = await import('@/server/db/legal');
  settingsReads = await import('@/server/db/settings');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

async function tableCounts() {
  const { db } = client;
  const one = async (query: Promise<{ n: number }[]>) =>
    (await query)[0]?.n ?? -1;
  return {
    categories: await one(db.select({ n: count() }).from(categories)),
    neighborhoods: await one(db.select({ n: count() }).from(neighborhoods)),
    hosts: await one(db.select({ n: count() }).from(hosts)),
    experiences: await one(db.select({ n: count() }).from(experiences)),
    prices: await one(db.select({ n: count() }).from(priceOptions)),
    templates: await one(db.select({ n: count() }).from(sessionTemplates)),
    sessions: await one(db.select({ n: count() }).from(sessions)),
    legal: await one(db.select({ n: count() }).from(legalDocuments)),
    collections: await one(db.select({ n: count() }).from(collections)),
    items: await one(db.select({ n: count() }).from(collectionItems)),
    modules: await one(db.select({ n: count() }).from(homeModules)),
    pages: await one(db.select({ n: count() }).from(pages)),
  };
}

/** Every stored experience through the guest read, which answers null for one a guest may not see. */
async function visibleToGuest() {
  const stored = await client.db
    .select({ id: experiences.id })
    .from(experiences);
  const read = await Promise.all(
    stored.map(({ id }) => catalogReads.getGuestExperience(id)),
  );
  return read.filter((experience) => experience !== null);
}

async function fingerprint() {
  const { db } = client;
  return {
    experiences: await db
      .select({
        id: experiences.id,
        slug: experiences.slug,
        createdAt: experiences.createdAt,
      })
      .from(experiences)
      .orderBy(experiences.slug),
    sessions: await db
      .select({ id: sessions.id, seatsSold: sessions.seatsSold })
      .from(sessions)
      .orderBy(sessions.id),
    legal: await db
      .select({
        id: legalDocuments.id,
        version: legalDocuments.version,
        publishedAt: legalDocuments.publishedAt,
      })
      .from(legalDocuments)
      .orderBy(legalDocuments.doc),
    collections: await db
      .select({ id: collections.id, publishedAt: collections.publishedAt })
      .from(collections)
      .orderBy(collections.slug),
  };
}

// Runs before any seeding: the database is empty, so a guard that fires late shows up as a row.
const nothingWritten = {
  categories: 0,
  neighborhoods: 0,
  hosts: 0,
  experiences: 0,
  legal: 0,
};

describe('a caller who is not ops', () => {
  const refused: [string, Caller][] = [
    ['a guest', { userId: 'g', roles: [Role.Guest], hostIds: [] }],
    ['a host owner', { userId: 'h', roles: [Role.HostOwner], hostIds: ['x'] }],
    ['nobody signed in', { userId: null, roles: [], hostIds: [] }],
  ];

  it.each(refused)(
    '%s may neither seed nor read the snapshot',
    async (_who, caller) => {
      await expect(runner.runSeed({ caller, now })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(reader.readSeedSnapshot(caller, now)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect(await tableCounts()).toMatchObject(nothingWritten);
    },
  );
});

describe('the curated seed', () => {
  let first: Awaited<ReturnType<typeof runner.runSeed>>;
  // Mocks are cleared between tests, so the tags are kept from the run that made them.
  let invalidated: string[] = [];

  it('fills a migrated database', async () => {
    first = await runner.runSeed({ caller: seedCaller, now });
    invalidated = vi.mocked(updateTag).mock.calls.map(([tag]) => tag);
    const counts = await tableCounts();
    expect(counts).toMatchObject({
      categories: 8,
      neighborhoods: 6,
      hosts: curated.hosts.length,
      experiences: curated.experiences.length,
      templates: curated.experiences.reduce((n, e) => n + e.slots.length, 0),
      legal: curated.legal.length,
      collections: curated.collections.length,
      modules: curated.homeModules.length,
      pages: curated.pageCopy.length,
    });
    expect(counts.sessions).toBe(
      planSessions(curated.hosts, curated.experiences, now).length,
    );
    expect(first.curated.sessionsCreated).toBe(counts.sessions);
    expect(first.scale).toBeUndefined();
  });

  it('holds every probe of the coverage matrix', async () => {
    const snapshot = await reader.readSeedSnapshot(seedCaller, now);
    const results = evaluateCoverage(snapshot, { scale: false });
    expect(coverageGaps(results)).toEqual([]);
    const probed = new Set<ProbeKey>(coverage.flatMap((e) => e.probes));
    expect(
      results.filter((r) => probed.has(r.key) && !r.ok && !r.skipped),
    ).toEqual([]);
  });

  it('yields zero browse results for kids in Williamsburg on every weeknight of the window, and the wheel class on a weekend', async () => {
    const asOf = minuteAsOf(now);
    const { from, to } = upcomingWindow(asOf, browseWindowDays);
    const last = Date.parse(to.toISOString().slice(0, 10));
    const dates: string[] = [];
    for (
      let day = Date.parse(from.toISOString().slice(0, 10));
      day <= last;
      day += msPerDay
    ) {
      dates.push(new Date(day).toISOString().slice(0, 10));
    }
    const slugsOn = async (date: string) =>
      (
        await browseReads.listBrowseExperiences(
          {
            filters: {
              categories: ['kids'],
              neighborhoods: ['williamsburg'],
              date,
              guests: null,
            },
            after: null,
          },
          asOf,
        )
      ).items.map((e) => e.slug);
    const found = await Promise.all(
      dates.map(async (date) => ({ date, slugs: await slugsOn(date) })),
    );
    const isWeekend = (date: string) =>
      [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    expect(
      found.filter(({ date, slugs }) => !isWeekend(date) && slugs.length > 0),
    ).toEqual([]);
    expect(
      found.some(
        ({ date, slugs }) =>
          isWeekend(date) && slugs.includes('kids-wheel-class'),
      ),
    ).toBe(true);
  });

  const afterEverySession = '2026-10-29T03:00:00.000Z';

  /** Every page of browse with no filters, followed by its cursor. A page is twelve, so a few pages cover the curated set. */
  async function unfilteredSlugs(asOf: string): Promise<string[]> {
    const slugs: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const read = await browseReads.listBrowseExperiences(
        { filters: noFilters, after },
        asOf,
      );
      slugs.push(...read.items.map((item) => item.slug));
      if (read.nextCursor === null) break;
      after = read.nextCursor;
    }
    return slugs.sort();
  }

  it.each([
    ['when it was seeded', minuteAsOf(now)],
    ['after the last session of the seed day', afterEverySession],
    ['after every seeded session', '2027-03-01T00:00:00.000Z'],
  ])(
    'lists every seeded experience a guest can see on browse with no filters, %s',
    async (_when, asOf) => {
      const shown = curated.experiences
        .filter(
          (experience) =>
            experience.status === 'guide_only' ||
            (experience.status === 'live' &&
              experience.prices.some((price) => price.usesSpace)),
        )
        .map((experience) => experience.slug)
        .sort();
      expect(shown.length).toBeGreaterThan(0);
      expect(await unfilteredSlugs(asOf)).toEqual(shown);
    },
  );

  it('lists nothing for a day with no session left, while the page with no day still lists every experience', async () => {
    const lastSeededDay = '2026-10-28';
    const onLastSeededDay = await browseReads.listBrowseExperiences(
      {
        filters: { ...noFilters, date: lastSeededDay },
        after: null,
      },
      afterEverySession,
    );
    expect(onLastSeededDay.items).toEqual([]);

    const days = browseDays(
      await browseReads.listBrowseDayRows(noFilters, afterEverySession),
    );
    // The empty page's way forward: the first listed day after the empty one has experiences.
    const nextDay = nextBrowseDay(days, lastSeededDay);
    expect(nextDay).not.toBeNull();
    const onNextDay = await browseReads.listBrowseExperiences(
      { filters: { ...noFilters, date: nextDay ?? null }, after: null },
      afterEverySession,
    );
    expect(onNextDay.items.length).toBeGreaterThan(0);
    expect((await unfilteredSlugs(afterEverySession)).length).toBeGreaterThan(
      onNextDay.items.length,
    );
  });

  it('holds the sessions the plan says, with the planned seats sold', async () => {
    const planned = planSessions(curated.hosts, curated.experiences, now);
    const stored = await client.db
      .select({
        slug: experiences.slug,
        localDate: sessions.localDate,
        startsAt: sessions.startsAt,
        seatsSold: sessions.seatsSold,
        allocation: sessions.allocation,
        source: sessions.source,
      })
      .from(sessions)
      .innerJoin(experiences, eq(sessions.experienceId, experiences.id));
    const key = (slug: string, startsAt: Date) =>
      `${slug}@${startsAt.toISOString()}`;
    const actual = new Map(stored.map((s) => [key(s.slug, s.startsAt), s]));
    expect(actual.size).toBe(planned.length);
    for (const plan of planned) {
      expect(actual.get(key(plan.experienceSlug, plan.startsAt))).toMatchObject(
        {
          seatsSold: plan.seatsSold,
          allocation: plan.allocation,
          source: plan.source,
        },
      );
    }
  });

  it('gives the same answers from the database as from the fixtures', async () => {
    const fromDatabase = evaluateCoverage(
      await reader.readSeedSnapshot(seedCaller, now),
      {
        scale: false,
      },
    );
    const fromFixtures = evaluateCoverage(
      snapshotFromFixtures(curated, undefined, now),
      { scale: false },
    );
    expect(fromDatabase).toEqual(fromFixtures);
  });

  it('shows a guest the live and guide-only experiences and nothing else', async () => {
    const visible = await visibleToGuest();
    const expected = curated.experiences
      .filter((e) => e.status === 'live' || e.status === 'guide_only')
      .map((e) => e.slug)
      .sort();
    expect(visible.map((e) => e.slug).sort()).toEqual(expected);
    expect(visible.every((e) => e.host.name.length > 0)).toBe(true);
    const guide = visible.find((e) => e.status === 'guide_only');
    expect(guide?.priceOptions).toEqual([]);
  });

  it('shows the published Picks without the paused entry, and the gift guide', async () => {
    const picks = await client.db
      .select({ slug: collections.slug })
      .from(collections)
      .where(
        and(eq(collections.kind, 'pick'), eq(collections.status, 'published')),
      );
    expect(picks.map((p) => p.slug).sort()).toEqual([
      'golden-hour',
      'rainy-day-sorted',
      'slow-saturday-mornings',
    ]);
    const golden = await editorialReads.getPublishedPick('golden-hour');
    expect(golden?.items).toHaveLength(3);
    expect(golden?.items.map((i) => i.experienceId)).not.toContain(
      experienceId('winter-paddle-series'),
    );
    const guide = await editorialReads.getPublishedGiftGuide();
    expect(guide?.items).toHaveLength(6);
    expect(
      await editorialReads.getPublishedPick('date-night-downtown'),
    ).toBeNull();
  });

  it('shows the six home modules in order and the copy of every category and neighborhood', async () => {
    const modules = await editorialReads.listHomeModules();
    expect(modules.map((m) => m.kind)).toEqual([
      'hero_search',
      'category_rail',
      'picks',
      'gift_guide',
      'this_week',
      'reassurance',
    ]);
    for (const copy of curated.pageCopy) {
      const found = await editorialReads.getPublishedPageCopy(
        copy.kind,
        copy.slug,
      );
      expect(found?.heading).toBe(copy.heading);
    }
  });

  it('publishes each legal document through the publish path, and the kayak names the waiver', async () => {
    const rows = await client.db.select().from(legalDocuments);
    expect(rows).toHaveLength(curated.legal.length);
    for (const row of rows) {
      expect(row).toMatchObject({ version: 1, status: 'published' });
      expect(row.publishedAt).not.toBeNull();
    }
    const waiver = await legalReads.getCurrentLegalDocument(
      'waiver-hudson-paddle-club',
    );
    const [kayak] = await client.db
      .select({
        waiverDocumentId: experiences.waiverDocumentId,
        waiverRequired: experiences.waiverRequired,
      })
      .from(experiences)
      .where(eq(experiences.slug, 'sunset-kayak-on-the-hudson'));
    expect(kayak).toEqual({
      waiverDocumentId: waiver?.id,
      waiverRequired: true,
    });
    expect((await legalReads.getCurrentLegalDocument('terms'))?.title).toBe(
      'Terms of service',
    );
  });

  it('leaves the settings row, and the tax rate the settings migration seeds, alone', async () => {
    const guest = await settingsReads.getGuestSettings();
    expect(guest.giftsEnabled).toBe(true);
    const [row] = await client.db
      .select({
        taxRatePpm: settings.taxRatePpm,
        bannerText: settings.bannerText,
      })
      .from(settings);
    expect(row).toEqual({ taxRatePpm: 88_750, bannerText: null });
  });

  it('invalidates the tags of what it published, through the data layer the script stubs outside Next', () => {
    expect(invalidated).toEqual(
      expect.arrayContaining([
        'gift-guide',
        'pick:rainy-day-sorted',
        'legal:terms',
        'category:cooking',
        'neighborhood:tribeca',
      ]),
    );
    expect(invalidated).not.toContain('pick:date-night-downtown');
  });

  it('gives every seeded host a booking notice address on the reserved .example domain', async () => {
    const stored = await client.db
      .select({ slug: hosts.slug, email: hosts.notificationEmail })
      .from(hosts);
    expect(stored).toHaveLength(curated.hosts.length);
    expect(stored.map((h) => [h.slug, h.email]).sort()).toEqual(
      curated.hosts.map((h) => [h.slug, `bookings@${h.slug}.example`]).sort(),
    );
  });

  it('accepts, under the table CHECK, the address of the longest host slug the seed can write', async () => {
    const longest = [
      ...curated.hosts,
      ...generateScaleFixtures({ experiences: maxScaleExperiences, seed: 1 })
        .hosts,
    ].reduce((a, b) => (b.slug.length > a.slug.length ? b : a));
    const rolledBack = new Error('roll back the probe');
    let accepted = false;
    await expect(
      client.db.transaction(async (tx) => {
        await tx.insert(hosts).values({
          ...hostRow({ slug: 'probe-host', name: 'Probe', description: 'D' }),
          notificationEmail: hostNotificationEmail(longest.slug),
        });
        accepted = true;
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
    expect(accepted).toBe(true);
  });

  describe('run again', () => {
    it('fills the address of a host that has none and leaves the others alone', async () => {
      const slug = 'hudson-paddle-club';
      await client.db
        .update(hosts)
        .set({ notificationEmail: null })
        .where(eq(hosts.slug, slug));
      const beforeCounts = await tableCounts();
      await runner.runSeed({ caller: seedCaller, now });
      const stored = await client.db
        .select({ slug: hosts.slug, email: hosts.notificationEmail })
        .from(hosts);
      expect(stored.find((h) => h.slug === slug)?.email).toBe(
        `bookings@${slug}.example`,
      );
      expect(stored.filter((h) => h.email === null)).toEqual([]);
      expect(await tableCounts()).toEqual(beforeCounts);
    });

    it('adds nothing and changes no id, version, publication time, or created-at', async () => {
      const beforeCounts = await tableCounts();
      const beforePrint = await fingerprint();
      const second = await runner.runSeed({ caller: seedCaller, now });
      expect(await tableCounts()).toEqual(beforeCounts);
      expect(await fingerprint()).toEqual(beforePrint);
      expect(second.curated.sessionsCreated).toBe(0);
      expect(second.curated.sessionsAlreadyThere).toBe(
        first.curated.sessionsCreated,
      );
      expect(second.curated.seatsAdjusted).toBe(0);
    });

    it('does not lower a session that has sold more than the plan', async () => {
      const [target] = await client.db
        .select({ id: sessions.id, allocation: sessions.allocation })
        .from(sessions)
        .innerJoin(experiences, eq(sessions.experienceId, experiences.id))
        .where(
          and(
            eq(experiences.slug, 'sunset-kayak-on-the-hudson'),
            eq(sessions.seatsSold, 11),
          ),
        )
        .limit(1);
      expect(target).toBeDefined();
      await client.db
        .update(sessions)
        .set({ seatsSold: target?.allocation ?? 0 })
        .where(eq(sessions.id, target?.id ?? ''));
      await runner.runSeed({ caller: seedCaller, now });
      const [after] = await client.db
        .select({ seatsSold: sessions.seatsSold })
        .from(sessions)
        .where(eq(sessions.id, target?.id ?? ''));
      expect(after?.seatsSold).toBe(target?.allocation);
      // Put the planned value back, so the states the later tests read are as the seed left them.
      await client.db
        .update(sessions)
        .set({ seatsSold: 11 })
        .where(eq(sessions.id, target?.id ?? ''));
    });

    it('publishes a draft that a stopped run left behind instead of starting another', async () => {
      await client.db.execute(sql`
        ALTER TABLE legal_documents DISABLE TRIGGER USER
      `);
      try {
        await client.db
          .update(legalDocuments)
          .set({ status: 'draft', publishedAt: null })
          .where(eq(legalDocuments.doc, 'privacy'));
      } finally {
        await client.db.execute(sql`
          ALTER TABLE legal_documents ENABLE TRIGGER USER
        `);
      }
      await runner.runSeed({ caller: seedCaller, now });
      const versions = await client.db
        .select({
          version: legalDocuments.version,
          status: legalDocuments.status,
        })
        .from(legalDocuments)
        .where(eq(legalDocuments.doc, 'privacy'));
      expect(versions).toEqual([{ version: 1, status: 'published' }]);
    });
  });
});

describe('a collision with a stored collection', () => {
  it('stops the seed with a seed message when a seeded slug holds another kind', async () => {
    const { db } = client;
    await db.delete(homeModules);
    await db.delete(collections).where(eq(collections.slug, 'gift-guide'));
    await db.insert(collections).values({
      kind: 'pick',
      slug: 'gift-guide',
      title: 'Mine',
      status: 'draft',
    });
    await expect(
      runner.runSeed({ caller: seedCaller, now }),
    ).rejects.toBeInstanceOf(SeedStepError);
    await expect(runner.runSeed({ caller: seedCaller, now })).rejects.toThrow(
      'already exists as another kind',
    );
    await db.delete(collections).where(eq(collections.slug, 'gift-guide'));
    await runner.runSeed({ caller: seedCaller, now });
    expect((await editorialReads.getPublishedGiftGuide())?.items).toHaveLength(
      6,
    );
  });
});

describe('the scale fixture', () => {
  const options = { experiences: 40, seed: 3 };

  it('writes the requested experiences and the hosts they need, and passes the scale probe', async () => {
    const before = await tableCounts();
    const report = await runner.runSeed({
      caller: seedCaller,
      now,
      scale: options,
    });
    const scale = generateScaleFixtures(options);
    expect(report.scale).toMatchObject({
      hosts: scale.hosts.length,
      experiences: 40,
    });
    const after = await tableCounts();
    expect(after.experiences - before.experiences).toBe(40);
    expect(after.hosts - before.hosts).toBe(scale.hosts.length);
    const results = evaluateCoverage(
      await reader.readSeedSnapshot(seedCaller, now),
      {
        scale: true,
      },
    );
    expect(coverageGaps(results)).toEqual([]);
    expect(results.find((r) => r.key === 'many-results')?.ok).toBe(true);
  });

  it('repeats exactly on a second run', async () => {
    const beforeCounts = await tableCounts();
    const beforePrint = await fingerprint();
    const second = await runner.runSeed({
      caller: seedCaller,
      now,
      scale: options,
    });
    expect(await tableCounts()).toEqual(beforeCounts);
    expect(await fingerprint()).toEqual(beforePrint);
    expect(second.scale?.sessionsCreated).toBe(0);
  });

  it('every scale experience reads back through the guest schema when visible', async () => {
    const visible = await visibleToGuest();
    expect(visible.length).toBeGreaterThan(30);
  });
});
