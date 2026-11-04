import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { guestHomeModules, type SeedSnapshot } from '@/lib/seed/coverage';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { helpArticles } from '@/server/db/schema';
import { unique } from './catalogFixtures';
import {
  collectionInput,
  doc,
  editorialFixtures,
  helpInput,
  insertOne,
  saved,
} from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - the home modules a guest sees match the seed coverage probe's own reading of them
// - guest reads return published content only; a home module whose collection is a draft is left out;
//   a malformed key is null
// - a stored document that needs repair is repaired on read

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');
let legal: typeof import('@/server/db/legal');
let settingsApi: typeof import('@/server/db/settings');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
  legal = await import('@/server/db/legal');
  settingsApi = await import('@/server/db/settings');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const ops = testCaller({ roles: [Role.Ops] });

const { insertCategory, insertNeighborhood } = editorialFixtures(
  () => client.db,
);

describe('guest reads', () => {
  describe('home modules', () => {
    let draftPickId: string;
    let publishedPickId: string;
    let draftPickSlug: string;
    let publishedPickSlug: string;

    beforeAll(async () => {
      const draft = (
        await saved(editorial.saveCollection(ops, collectionInput()))
      ).value;
      draftPickId = draft.id;
      draftPickSlug = draft.slug;
      const published = (
        await saved(
          editorial.saveCollection(
            ops,
            collectionInput({ status: 'published' }),
          ),
        )
      ).value;
      publishedPickId = published.id;
      publishedPickSlug = published.slug;
    });

    const homeModule = (
      kind: 'hero_search' | 'picks' | 'this_week' | 'reassurance',
      extra: Partial<{
        enabled: boolean;
        heading: string;
        collectionId: string;
      }> = {},
    ) => ({
      kind,
      enabled: extra.enabled ?? true,
      heading: extra.heading ?? null,
      body: null,
      collectionId: extra.collectionId ?? null,
    });

    it('lists the enabled modules in order and leaves out one whose collection is a draft', async () => {
      await saved(
        editorial.saveHomeModules(ops, [
          homeModule('hero_search', { heading: 'First' }),
          homeModule('picks', { collectionId: draftPickId, heading: 'Hidden' }),
          homeModule('this_week', { enabled: false, heading: 'Off' }),
          homeModule('picks', {
            collectionId: publishedPickId,
            heading: 'Third',
          }),
          homeModule('reassurance', { heading: 'Last' }),
        ]),
      );

      const listed = await editorial.listHomeModules();

      expect(listed.map((entry) => entry.heading)).toEqual([
        'First',
        'Third',
        'Last',
      ]);
      const forEditing = await editorial.listHomeModulesForEditing(ops);
      expect(forEditing.map((entry) => entry.position)).toEqual([
        0, 1, 2, 3, 4,
      ]);
    });

    it('lists the same modules the seed coverage probe counts as visible to a guest', async () => {
      await saved(
        editorial.saveHomeModules(ops, [
          homeModule('hero_search'),
          homeModule('picks', { collectionId: draftPickId }),
          homeModule('this_week', { enabled: false }),
          homeModule('picks', { collectionId: publishedPickId }),
          homeModule('picks', {
            collectionId: publishedPickId,
            enabled: false,
          }),
          homeModule('reassurance'),
        ]),
      );
      const slugOf = new Map([
        [draftPickId, draftPickSlug],
        [publishedPickId, publishedPickSlug],
      ]);
      const snapshot = {
        collections: [
          { slug: draftPickSlug, status: 'draft' },
          { slug: publishedPickSlug, status: 'published' },
        ],
        homeModules: (await editorial.listHomeModulesForEditing(ops)).map(
          (entry) => ({
            kind: entry.kind,
            enabled: entry.enabled,
            collectionSlug: entry.collectionId
              ? (slugOf.get(entry.collectionId) ?? null)
              : null,
            hasBody: false,
          }),
        ),
      } as unknown as SeedSnapshot;

      const listed = (await editorial.listHomeModules()).map((entry) => [
        entry.kind,
        entry.collectionId ? slugOf.get(entry.collectionId) : null,
      ]);

      expect(listed).toHaveLength(3);
      expect(
        guestHomeModules(snapshot).map((entry) => [
          entry.kind,
          entry.collectionSlug,
        ]),
      ).toEqual(listed);
    });

    it('leaves out a switched-off module pinned to a published collection, and lists it once switched on', async () => {
      const save = (enabled: boolean) =>
        saved(
          editorial.saveHomeModules(ops, [
            homeModule('picks', {
              enabled,
              collectionId: publishedPickId,
              heading: 'Pinned',
            }),
            homeModule('reassurance', { heading: 'Last' }),
          ]),
        );

      await save(false);
      expect((await editorial.listHomeModules()).map((m) => m.heading)).toEqual(
        ['Last'],
      );

      await save(true);
      expect((await editorial.listHomeModules()).map((m) => m.heading)).toEqual(
        ['Pinned', 'Last'],
      );
    });
  });

  describe('page copy', () => {
    it('returns published copy by the slug of its category or neighborhood and nothing else', async () => {
      const category = await insertCategory();
      const neighborhood = await insertNeighborhood();
      const draftCategory = await insertCategory();
      const copy = (
        kind: 'category' | 'neighborhood',
        targetId: string,
        status: 'draft' | 'published',
      ) => ({
        kind,
        targetId,
        heading: 'Things to do',
        metaDescription: 'Meta',
        status,
        intro: doc('Intro'),
        body: null,
      });
      await saved(
        editorial.savePageCopy(ops, copy('category', category.id, 'published')),
      );
      await saved(
        editorial.savePageCopy(
          ops,
          copy('neighborhood', neighborhood.id, 'published'),
        ),
      );
      await saved(
        editorial.savePageCopy(
          ops,
          copy('category', draftCategory.id, 'draft'),
        ),
      );

      expect(
        await editorial.getPublishedPageCopy('category', category.slug),
      ).toMatchObject({
        kind: 'category',
        slug: category.slug,
        heading: 'Things to do',
      });
      expect(
        await editorial.getPublishedPageCopy('neighborhood', neighborhood.slug),
      ).toMatchObject({ kind: 'neighborhood', slug: neighborhood.slug });
      expect(
        await editorial.getPublishedPageCopy('category', draftCategory.slug),
      ).toBeNull();
      expect(
        await editorial.getPublishedPageCopy('neighborhood', category.slug),
      ).toBeNull();
      expect(
        await editorial.getPublishedPageCopy('category', 'Bad Slug'),
      ).toBeNull();
      const all = await editorial.listPageCopyForEditing(ops);
      expect(all.map((entry) => entry.slug)).toEqual(
        expect.arrayContaining([
          category.slug,
          neighborhood.slug,
          draftCategory.slug,
        ]),
      );
    });
  });

  describe('help articles', () => {
    it('lists published articles by position without their body and finds one by slug', async () => {
      const second = unique('help-b');
      const first = unique('help-a');
      const hidden = unique('help-draft');
      await saved(
        editorial.saveHelpArticle(
          ops,
          helpInput({
            slug: second,
            title: 'Second',
            position: 2000,
            status: 'published',
          }),
        ),
      );
      await saved(
        editorial.saveHelpArticle(
          ops,
          helpInput({
            slug: first,
            title: 'First',
            position: 1000,
            status: 'published',
          }),
        ),
      );
      await saved(editorial.saveHelpArticle(ops, helpInput({ slug: hidden })));

      const listed = await editorial.listPublishedHelpArticles();

      const slugs = listed.map((article) => article.slug);
      expect(slugs.indexOf(first)).toBeLessThan(slugs.indexOf(second));
      expect(slugs).not.toContain(hidden);
      expect(listed[0]).not.toHaveProperty('body');
      expect(await editorial.getPublishedHelpArticle(first)).toMatchObject({
        title: 'First',
        body: doc(),
      });
      expect(await editorial.getPublishedHelpArticle(hidden)).toBeNull();
      expect(await editorial.getPublishedHelpArticle('Not A Slug')).toBeNull();
      const forEditing = await editorial.listHelpArticlesForEditing(ops);
      expect(forEditing.map((article) => article.slug)).toContain(hidden);
    });
  });

  it('repairs a stored document that needs repair instead of throwing', async () => {
    const slug = unique('help-corrupt');
    const row = await insertOne(
      client.db
        .insert(helpArticles)
        .values({
          slug,
          title: 'Corrupt',
          body: {
            type: 'doc',
            content: [{ type: 'script', content: [] }],
          } as never,
          status: 'published',
          publishedAt: new Date('2026-10-01T00:00:00Z'),
        })
        .returning(),
    );

    const article = await editorial.getPublishedHelpArticle(slug);

    expect(article?.id).toBe(row.id);
    expect(article?.body).toEqual({ type: 'doc', content: [] });
  });

  describe('legal documents', () => {
    it('reads the highest published version as the current one, never a draft', async () => {
      const key = 'waiver-current';
      const v1 = await legal.createLegalDraft(ops, {
        doc: key,
        title: 'v1',
        body: doc('One'),
      });
      await saved(legal.publishLegalDocument(ops, v1.id));
      const v2 = await legal.createLegalDraft(ops, {
        doc: key,
        title: 'v2',
        body: doc('Two'),
      });
      await saved(legal.publishLegalDocument(ops, v2.id));
      await legal.createLegalDraft(ops, {
        doc: key,
        title: 'v3 draft',
        body: doc('Three'),
      });

      const current = await legal.getCurrentLegalDocument(key);

      expect(current).toMatchObject({
        doc: key,
        version: 2,
        title: 'v2',
        body: doc('Two'),
      });
      expect(await legal.getPublishedLegalDocument(v1.id)).toMatchObject({
        version: 1,
      });
      const versions = await legal.listLegalVersions(ops, key);
      expect(versions.map((entry) => [entry.version, entry.status])).toEqual([
        [3, 'draft'],
        [2, 'published'],
        [1, 'published'],
      ]);
    });

    it.each([
      ['a document with nothing published', 'waiver-nothing'],
      ['a malformed key', 'Terms'],
      ['an empty key', ''],
    ])('returns null for %s', async (_name, key) => {
      await legal.createLegalDraft(ops, {
        doc: 'waiver-nothing',
        title: 'Draft only',
        body: doc(),
      });

      expect(await legal.getCurrentLegalDocument(key)).toBeNull();
    });

    it('returns null for a draft by id and for a malformed id', async () => {
      const draft = await legal.createLegalDraft(ops, {
        doc: 'waiver-by-id',
        title: 'Draft',
        body: doc(),
      });

      expect(await legal.getPublishedLegalDocument(draft.id)).toBeNull();
      expect(await legal.getPublishedLegalDocument('nope')).toBeNull();
      expect(await legal.listLegalVersions(ops, 'Terms')).toEqual([]);
    });
  });

  describe('settings', () => {
    it('shows a guest the banner and the switches and no rate, window, or length', async () => {
      await settingsApi.updateSettings(ops, {
        bannerText: 'Heads up',
        bookingsPaused: true,
      });

      const visible = await settingsApi.getGuestSettings();

      expect(visible).toEqual({
        bannerText: 'Heads up',
        bookingsPaused: true,
        giftsEnabled: true,
        checkoutMaintenance: false,
      });
      await settingsApi.updateSettings(ops, {
        bannerText: null,
        bookingsPaused: false,
      });
    });
  });
});
