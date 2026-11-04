import { ZodError } from 'zod';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { editorialLimits, picksCandidates } from '@/lib/editorial';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { collections } from '@/server/db/schema';
import { id as uuid } from '../support/ids';
import { unique } from './catalogFixtures';
import {
  collectionInput,
  doc,
  editorialFixtures,
  saved,
} from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - guest reads return published content only; collection entries a guest cannot see are left out
// - the home Picks read finds the Picks it is asked for however many others are published, reads their
//   first entries and a count of the rest, and never the intro

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const ops = testCaller({ roles: [Role.Ops] });

const { insertExperience } = editorialFixtures(() => client.db);

describe('guest reads', () => {
  let liveId: string;
  let guideId: string;
  let draftExperienceId: string;
  let pausedExperienceId: string;

  beforeAll(async () => {
    liveId = (await insertExperience('live')).id;
    guideId = (
      await insertExperience('live', {
        status: 'guide_only',
        linkOutUrl: 'https://example.com/class',
      })
    ).id;
    draftExperienceId = (await insertExperience('draft')).id;
    pausedExperienceId = (await insertExperience('paused')).id;
  });

  describe('collections', () => {
    const published = unique('read-pick');
    const draft = unique('read-draft');
    let publishedId: string;
    let draftId: string;
    let emptyId: string;

    beforeAll(async () => {
      publishedId = (
        await saved(
          editorial.saveCollection(
            ops,
            collectionInput({
              slug: published,
              title: 'Published',
              status: 'published',
              intro: doc('Intro'),
              items: [
                { experienceId: guideId, note: 'Second on the list' },
                { experienceId: draftExperienceId, note: null },
                { experienceId: liveId, note: null },
                { experienceId: pausedExperienceId, note: null },
              ],
            }),
          ),
        )
      ).value.id;
      draftId = (
        await saved(
          editorial.saveCollection(ops, collectionInput({ slug: draft })),
        )
      ).value.id;
      emptyId = (
        await saved(
          editorial.saveCollection(
            ops,
            collectionInput({
              status: 'published',
              items: [{ experienceId: draftExperienceId, note: null }],
            }),
          ),
        )
      ).value.id;
    });

    it('reads a published pick by ID with only the entries a guest can see, in order, and their count', async () => {
      const [pick] = await editorial.listHomePicks([publishedId]);

      expect(pick).toEqual({
        id: publishedId,
        slug: published,
        title: 'Published',
        summary: null,
        itemCount: 2,
        experienceIds: [guideId, liveId],
      });
      expect(pick).not.toHaveProperty('intro');
    });

    it('leaves out a draft pick and an ID nothing has', async () => {
      const picks = await editorial.listHomePicks([draftId, uuid(404)]);

      expect(picks).toEqual([]);
    });

    it('reads nothing for no IDs', async () => {
      expect(await editorial.listHomePicks([])).toEqual([]);
    });

    it('refuses more IDs than the home page has modules, and an ID that is not one', async () => {
      const tooMany = Array.from(
        { length: editorialLimits.homeModules + 1 },
        (_, n) => uuid(n + 1),
      );

      await expect(editorial.listHomePicks(tooMany)).rejects.toThrow(ZodError);
      await expect(editorial.listHomePicks(['nope'])).rejects.toThrow(ZodError);
    });

    it('reads a pick with no visible entry as an empty one', async () => {
      const [pick] = await editorial.listHomePicks([emptyId]);

      expect(pick).toMatchObject({ itemCount: 0, experienceIds: [] });
    });

    it.each([
      ['a draft', () => draft],
      ['a slug that does not exist', () => 'no-such-pick'],
      ['a malformed slug', () => 'Not A Slug'],
      ['an empty slug', () => ''],
    ])('looks up %s as null', async (_name, slug) => {
      expect(await editorial.getPublishedPick(slug())).toBeNull();
    });

    it('looks up a published pick by slug', async () => {
      expect(await editorial.getPublishedPick(published)).toMatchObject({
        slug: published,
      });
    });

    it('shows a draft to staff, with every entry', async () => {
      const all = await editorial.listCollectionsForEditing(ops);

      expect(all.map((entry) => entry.slug)).toContain(draft);
      expect(all.find((entry) => entry.slug === published)?.items).toHaveLength(
        4,
      );
    });
  });

  describe('the gift guide', () => {
    it('is null until one is published, then is the one guide with its visible entries', async () => {
      expect(await editorial.getPublishedGiftGuide()).toBeNull();

      const guide = await saved(
        editorial.saveCollection(
          ops,
          collectionInput({
            kind: 'gift_guide',
            slug: 'gift-guide',
            status: 'draft',
            items: [{ experienceId: liveId, note: null }],
          }),
        ),
      );
      expect(await editorial.getPublishedGiftGuide()).toBeNull();

      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({
            kind: 'gift_guide',
            slug: 'gift-guide',
            status: 'published',
            items: [{ experienceId: liveId, note: null }],
          }),
          id: guide.value.id,
        }),
      );

      expect(await editorial.getPublishedGiftGuide()).toMatchObject({
        kind: 'gift_guide',
        items: [{ experienceId: liveId }],
      });
    });

    it('reads for the home page only its copy, with no intro and no entries', async () => {
      const existing = await editorial.getPublishedGiftGuide();
      const guide = await saved(
        editorial.saveCollection(ops, {
          id: existing?.id,
          ...collectionInput({
            kind: 'gift_guide',
            slug: 'gift-guide',
            title: 'Give a Saturday',
            summary: 'They pick the date.',
            intro: doc('Intro'),
            status: 'published',
            items: [{ experienceId: liveId, note: null }],
          }),
        }),
      );

      const home = await editorial.getHomeGiftGuide();

      expect(home).toEqual({
        id: guide.value.id,
        title: 'Give a Saturday',
        summary: 'They pick the date.',
      });
      expect(home).not.toHaveProperty('intro');
      expect(home).not.toHaveProperty('items');
    });

    it('cannot be a second one, in the data layer or the table', async () => {
      await expect(
        editorial.saveCollection(
          ops,
          collectionInput({ kind: 'gift_guide', slug: 'second-guide' }),
        ),
      ).resolves.toEqual({ status: 'gift_guide_exists' });
      await expect(
        client.db
          .insert(collections)
          .values({ kind: 'gift_guide', slug: 'third-guide', title: 'Third' }),
      ).rejects.toMatchObject({
        cause: { constraint: 'collections_one_gift_guide' },
      });
    });
  });
});

describe('the home Picks read when many Picks are published', () => {
  const crowd = unique('crowd');

  afterAll(async () => {
    await client.db
      .delete(collections)
      .where(sql`${collections.slug} like ${`${crowd}-%`}`);
  });

  it('finds a named pick past the list limit, with the first entries and the full count, and no intro', async () => {
    const experienceIds = [];
    for (let n = 0; n < picksCandidates + 3; n += 1) {
      experienceIds.push((await insertExperience('live')).id);
    }
    const named = await saved(
      editorial.saveCollection(
        ops,
        collectionInput({
          slug: `${crowd}-named`,
          // Sorts last by title, so a read capped at the list limit would cut it off.
          title: 'zzzz named',
          status: 'published',
          intro: doc('A long intro'),
          items: experienceIds.map((experienceId) => ({
            experienceId,
            note: null,
          })),
        }),
      ),
    );
    await client.db.insert(collections).values(
      Array.from({ length: editorialLimits.listed + 1 }, (_, n) => ({
        kind: 'pick' as const,
        slug: `${crowd}-${String(n)}`,
        title: `Crowd ${String(n).padStart(3, '0')}`,
        status: 'published' as const,
        publishedAt: new Date(),
      })),
    );

    const [pick, ...others] = await editorial.listHomePicks([named.value.id]);

    expect(others).toEqual([]);
    expect(pick?.id).toBe(named.value.id);
    expect(pick?.itemCount).toBe(experienceIds.length);
    expect(pick?.experienceIds).toEqual(
      experienceIds.slice(0, picksCandidates),
    );
    expect(pick).not.toHaveProperty('intro');
    expect(pick).not.toHaveProperty('items');

    // The same shared read in its full shape keeps the intro and every entry.
    const full = await editorial.getPublishedPick(`${crowd}-named`);
    expect(full?.items).toHaveLength(experienceIds.length);
    expect(full?.intro).toEqual(doc('A long intro'));
  });
});
