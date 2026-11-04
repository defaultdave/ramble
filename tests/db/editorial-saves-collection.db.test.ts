import { updateTag } from 'next/cache';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { collectionItems, collections } from '@/server/db/schema';
import { id as uuid } from '../support/ids';
import { unique } from './catalogFixtures';
import { collectionInput, editorialFixtures, saved } from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - saving a collection creates or replaces it with its entries in order, refuses a taken slug, a second
//   gift guide, an unknown experience, and a wrong id or kind, stamps the publication time once
// - a save invalidates the tags of what was and is published, and nothing for a draft that stays a draft
// - input the Zod schemas refuse writes nothing
// - ids written in capitals find what they name

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

beforeEach(() => {
  vi.mocked(updateTag).mockClear();
});

const ops = testCaller({ roles: [Role.Ops] });

const { insertExperience } = editorialFixtures(() => client.db);

const tagsUpdated = () => vi.mocked(updateTag).mock.calls.map(([tag]) => tag);

describe('saving a collection', () => {
  it('creates a draft with its entries in order and stamps nothing', async () => {
    const [a, b, c] = [
      await insertExperience(),
      await insertExperience(),
      await insertExperience(),
    ];

    const result = await saved(
      editorial.saveCollection(
        ops,
        collectionInput({
          items: [
            { experienceId: c.id, note: 'Third by id, first in the list' },
            { experienceId: a.id, note: null },
            { experienceId: b.id, note: null },
          ],
        }),
      ),
    );

    expect(result.value.status).toBe('draft');
    expect(result.value.publishedAt).toBeNull();
    const stored = await client.db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, result.value.id));
    expect(
      stored
        .toSorted((x, y) => x.position - y.position)
        .map((row) => [row.position, row.experienceId]),
    ).toEqual([
      [0, c.id],
      [1, a.id],
      [2, b.id],
    ]);
  });

  it('replaces the entries and keeps the first publication time while it stays published', async () => {
    const first = await insertExperience();
    const second = await insertExperience();
    const input = collectionInput({
      status: 'published',
      items: [{ experienceId: first.id, note: null }],
    });
    const created = await saved(editorial.saveCollection(ops, input));

    const edited = await saved(
      editorial.saveCollection(ops, {
        ...input,
        id: created.value.id,
        title: 'Renamed',
        items: [{ experienceId: second.id, note: 'New' }],
      }),
    );

    expect(edited.value.title).toBe('Renamed');
    expect(edited.value.items).toEqual([
      { experienceId: second.id, note: 'New' },
    ]);
    expect(edited.value.publishedAt).toEqual(created.value.publishedAt);
    const stored = await client.db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, created.value.id));
    expect(stored.map((row) => row.experienceId)).toEqual([second.id]);
  });

  it('clears the publication time when a pick goes back to draft and stamps a new one when it is published again', async () => {
    const input = collectionInput({ status: 'published' });
    const created = await saved(editorial.saveCollection(ops, input));
    const withId = { ...input, id: created.value.id };

    const back = await saved(
      editorial.saveCollection(ops, { ...withId, status: 'draft' }),
    );
    const again = await saved(editorial.saveCollection(ops, withId));

    expect(back.value.publishedAt).toBeNull();
    expect(again.value.publishedAt).toBeInstanceOf(Date);
  });

  it('refuses a slug another collection holds, and takes its own back', async () => {
    const slug = unique('taken');
    const holder = await saved(
      editorial.saveCollection(ops, collectionInput({ slug })),
    );

    await expect(
      editorial.saveCollection(ops, collectionInput({ slug })),
    ).resolves.toEqual({ status: 'slug_taken' });
    await expect(
      editorial.saveCollection(ops, {
        ...collectionInput({ slug }),
        id: holder.value.id,
      }),
    ).resolves.toMatchObject({ status: 'saved' });
  });

  it('refuses an experience that does not exist and writes nothing', async () => {
    const slug = unique('ghost');

    await expect(
      editorial.saveCollection(
        ops,
        collectionInput({
          slug,
          items: [{ experienceId: uuid(404), note: null }],
        }),
      ),
    ).resolves.toEqual({ status: 'unknown_experience' });
    expect(
      await client.db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug)),
    ).toEqual([]);
  });

  it('treats an id that matches nothing as not found', async () => {
    await expect(
      editorial.saveCollection(ops, { ...collectionInput(), id: uuid(404) }),
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('treats the id of a collection of another kind as not found', async () => {
    const pick = await saved(editorial.saveCollection(ops, collectionInput()));

    await expect(
      editorial.saveCollection(ops, {
        ...collectionInput({ kind: 'gift_guide', slug: unique('as-guide') }),
        id: pick.value.id,
      }),
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('refuses input the schema refuses, without writing', async () => {
    const slug = unique('unsafe');
    const unsafe = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    } as never;

    await expect(
      editorial.saveCollection(ops, collectionInput({ slug, intro: unsafe })),
    ).rejects.toThrow();
    await expect(
      editorial.saveCollection(ops, collectionInput({ slug, title: ' ' })),
    ).rejects.toThrow();
    expect(
      await client.db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug)),
    ).toEqual([]);
  });

  describe('invalidation', () => {
    beforeAll(async () => {
      await saved(
        editorial.saveCollection(
          ops,
          collectionInput({
            kind: 'gift_guide',
            slug: unique('invalidation-guide'),
          }),
        ),
      );
    });

    it('invalidates a pick and the home page when it is published', async () => {
      const slug = unique('tag-publish');

      await saved(
        editorial.saveCollection(
          ops,
          collectionInput({ slug, status: 'published' }),
        ),
      );

      expect(tagsUpdated()).toEqual(['home', `pick:${slug}`]);
    });

    it('invalidates nothing for a draft that stays a draft', async () => {
      const draft = await saved(
        editorial.saveCollection(ops, collectionInput()),
      );
      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({ slug: draft.value.slug }),
          id: draft.value.id,
          title: 'Edited draft',
        }),
      );

      expect(updateTag).not.toHaveBeenCalled();
    });

    it('invalidates when a published pick goes back to draft', async () => {
      const slug = unique('tag-unpublish');
      const created = await saved(
        editorial.saveCollection(
          ops,
          collectionInput({ slug, status: 'published' }),
        ),
      );
      vi.mocked(updateTag).mockClear();

      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({ slug }),
          id: created.value.id,
        }),
      );

      expect(tagsUpdated()).toEqual(['home', `pick:${slug}`]);
    });

    it('invalidates the old and the new address when a published pick is renamed', async () => {
      const oldSlug = unique('tag-old');
      const newSlug = unique('tag-new');
      const created = await saved(
        editorial.saveCollection(
          ops,
          collectionInput({ slug: oldSlug, status: 'published' }),
        ),
      );
      vi.mocked(updateTag).mockClear();

      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({ slug: newSlug, status: 'published' }),
          id: created.value.id,
        }),
      );

      expect(tagsUpdated()).toEqual(
        ['home', `pick:${oldSlug}`, `pick:${newSlug}`].toSorted(),
      );
    });

    it('invalidates the gift guide tags for the gift guide', async () => {
      const guide = await editorial.listCollectionsForEditing(ops);
      const existing = guide.find((entry) => entry.kind === 'gift_guide');
      if (!existing) throw new Error('An earlier test saved the gift guide');

      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({
            kind: 'gift_guide',
            slug: existing.slug,
            status: 'published',
          }),
          id: existing.id,
        }),
      );

      expect(tagsUpdated()).toEqual(['gift-guide', 'home']);
    });

    it('invalidates nothing when the save is refused', async () => {
      await editorial.saveCollection(
        ops,
        collectionInput({
          status: 'published',
          items: [{ experienceId: uuid(404), note: null }],
        }),
      );

      expect(updateTag).not.toHaveBeenCalled();
    });
  });
});

describe('ids written in capitals', () => {
  it('find the experience a collection lists, instead of reporting it unknown', async () => {
    const experience = await insertExperience();

    const result = await editorial.saveCollection(
      ops,
      collectionInput({
        items: [{ experienceId: experience.id.toUpperCase(), note: null }],
      }),
    );

    expect(result).toMatchObject({
      status: 'saved',
      value: { items: [{ experienceId: experience.id }] },
    });
  });

  it('find the collection a home module shows, instead of reporting it unknown', async () => {
    const pick = await saved(editorial.saveCollection(ops, collectionInput()));

    const result = await editorial.saveHomeModules(ops, [
      {
        kind: 'picks',
        enabled: true,
        heading: 'Shown',
        body: null,
        collectionId: pick.value.id.toUpperCase(),
      },
    ]);

    expect(result).toMatchObject({
      status: 'saved',
      value: [{ collectionId: pick.value.id }],
    });
  });
});
