import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { browsePageSize, type BrowsePage } from '@/lib/pages/browse';
import { noFilters } from '@/lib/filters';
import { experiences, photos, priceOptions } from '@/server/db/schema';
import {
  asOf,
  browseFixtures,
  browseReads,
  filtersFor,
  names,
  type Scope,
} from './browseFixtures';
import { unique } from './catalogFixtures';
import {
  createFreshDatabase,
  expectConstraint,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - a guest sees live and guide-only experiences, never draft, in review or paused ones
// - a live experience with no price is left out, and a guide-only entry with none is kept
// - a guide-only row with no link out cannot be stored, by insert or by update, so no browse card lacks its link
// - a live experience that loses its last price leaves the read, so no browse card lacks a price
// - a card carries the lowest-position photo as its cover, and an experience with no photo still lists with a null image
// - results come by name and then id, and the page is cut at the hard size with a cursor
// - the next page starts after the cursor and no row is shown twice or skipped, including two rows with one name
// - a row added before the cursor, or hidden after it, between two pages moves nothing already shown
// - a cursor for a hidden or unknown experience finds no row and reads no page; a visible one returns its row
// - the cursor row is read once per request, as its own query, and the page query does not read it again
// - category and neighborhood filters match any value of their list and both must hold; an unknown slug matches nothing

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let browse: typeof import('@/server/db/browse');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  browse = await import('@/server/db/browse');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const { scope, insertExperience } = browseFixtures(() => client.db);
const { list } = browseReads(() => browse);

describe('what a guest sees', () => {
  it('lists live and guide-only experiences and hides every other status', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'A live' });
    await insertExperience(where, { name: 'B guide', status: 'guide_only' });
    await insertExperience(where, { name: 'C draft', status: 'draft' });
    await insertExperience(where, { name: 'D review', status: 'in_review' });
    await insertExperience(where, { name: 'E paused', status: 'paused' });

    expect(names(await list(filtersFor(where)))).toEqual(['A live', 'B guide']);
  });

  it('leaves out a live experience with no price and keeps a guide entry with none', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'A priced' });
    await insertExperience(where, { name: 'B unpriced', price: null });
    await insertExperience(where, { name: 'C guide', status: 'guide_only' });

    expect(names(await list(filtersFor(where)))).toEqual([
      'A priced',
      'C guide',
    ]);
  });

  it('leaves out a live experience whose only price option takes no space', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'A priced' });
    const accompanyingOnly = await insertExperience(where, {
      name: 'B accompanying only',
      price: null,
    });
    await client.db.insert(priceOptions).values({
      experienceId: accompanyingOnly.id,
      kind: 'adult',
      priceMinor: 0,
      usesSpace: false,
    });

    expect(names(await list(filtersFor(where)))).toEqual(['A priced']);
  });

  it('keeps a kids class whose free accompanying adult sits beside a paid child, and says which option takes a space', async () => {
    const where = await scope();
    const kidsClass = await insertExperience(where, {
      name: 'A kids class',
      price: null,
    });
    await client.db.insert(priceOptions).values([
      {
        experienceId: kidsClass.id,
        kind: 'adult',
        priceMinor: 0,
        usesSpace: false,
      },
      { experienceId: kidsClass.id, kind: 'child', priceMinor: 4500 },
    ]);

    const [item] = (await list(filtersFor(where))).items;

    expect(item?.priceOptions).toEqual([
      { priceMinor: 0, usesSpace: false },
      { priceMinor: 4500, usesSpace: true },
    ]);
  });

  it('leaves out a live experience once its last price is removed', async () => {
    const where = await scope();
    const kept = await insertExperience(where, { name: 'A kept' });
    const dropped = await insertExperience(where, { name: 'B dropped' });
    expect(names(await list(filtersFor(where)))).toEqual([
      'A kept',
      'B dropped',
    ]);

    await client.db
      .delete(priceOptions)
      .where(eq(priceOptions.experienceId, dropped.id));

    const page = await list(filtersFor(where));
    expect(page.items.map(({ id }) => id)).toEqual([kept.id]);
  });

  it.each([
    [
      'an insert',
      (where: Scope) =>
        client.db.insert(experiences).values({
          hostId: where.hostId,
          categoryId: where.category.id,
          neighborhoodId: where.neighborhood.id,
          cancellationTierId: where.cancellationTierId,
          slug: unique('experience'),
          name: unique('Experience'),
          status: 'guide_only',
        }),
    ],
    [
      'moving a live experience to guide-only',
      async (where: Scope) => {
        const row = await insertExperience(where);
        await client.db
          .update(experiences)
          .set({ status: 'guide_only' })
          .where(eq(experiences.id, row.id));
      },
    ],
    [
      'removing the link of a guide entry',
      async (where: Scope) => {
        const row = await insertExperience(where, { status: 'guide_only' });
        await client.db
          .update(experiences)
          .set({ linkOutUrl: null })
          .where(eq(experiences.id, row.id));
      },
    ],
  ])('refuses a guide-only row with no link by %s', async (_name, attempt) => {
    await expectConstraint(
      attempt(await scope()),
      'experiences_guide_only_has_link',
    );
  });

  it('carries what a card shows and nothing a guest may not see', async () => {
    const where = await scope();
    const adult = await insertExperience(where, {
      name: 'A card',
      durationMinutes: 150,
      price: 7000,
    });
    await client.db
      .insert(priceOptions)
      .values({ experienceId: adult.id, kind: 'child', priceMinor: 3500 });

    const [item] = (await list(filtersFor(where))).items;

    expect(item).toEqual({
      id: adult.id,
      slug: adult.slug,
      name: 'A card',
      status: 'live',
      neighborhoodName: where.neighborhood.name,
      durationMinutes: 150,
      linkOutUrl: null,
      image: null,
      priceOptions: [
        { priceMinor: 3500, usesSpace: true },
        { priceMinor: 7000, usesSpace: true },
      ],
    });
  });
});

describe('paging', () => {
  it('cuts a page at the hard size and starts the next one after its last row', async () => {
    const where = await scope();
    for (let n = 1; n <= browsePageSize + 1; n += 1) {
      await insertExperience(where, {
        name: `Row ${String(n).padStart(2, '0')}`,
      });
    }

    const first = await list(filtersFor(where));
    expect(first.items).toHaveLength(browsePageSize);
    expect(first.nextCursor).toBe(first.items[browsePageSize - 1]?.id);

    const second = await list(filtersFor(where), first.nextCursor);
    expect(names(second)).toEqual([
      `Row ${String(browsePageSize + 1).padStart(2, '0')}`,
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('has no next page when the rows fill a page exactly', async () => {
    const where = await scope();
    for (let n = 1; n <= browsePageSize; n += 1) {
      await insertExperience(where);
    }

    expect((await list(filtersFor(where))).nextCursor).toBeNull();
  });

  it('shows no row twice and skips none across a page boundary, with rows that share a name', async () => {
    const where = await scope();
    const total = browsePageSize * 2 + 3;
    const made = [];
    for (let n = 0; n < total; n += 1) {
      // Every row has the same name, so the id alone decides the order.
      made.push(await insertExperience(where, { name: 'Same name' }));
    }

    const seen: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 5; guard += 1) {
      const page: Extract<BrowsePage, { ok: true }> = await list(
        filtersFor(where),
        after,
      );
      seen.push(...page.items.map(({ id }) => id));
      after = page.nextCursor;
      if (after === null) break;
    }

    expect(seen).toEqual(made.map(({ id }) => id).sort());
  });

  it('moves nothing already shown when a row is added before the cursor or hidden after it', async () => {
    const where = await scope();
    for (let n = 1; n <= browsePageSize + 4; n += 1) {
      await insertExperience(where, {
        name: `Row ${String(n).padStart(2, '0')}`,
      });
    }
    const first = await list(filtersFor(where));
    const afterRows = (await list(filtersFor(where), first.nextCursor)).items;
    const hidden = afterRows[0];
    if (!hidden) throw new Error('expected a row after the cursor');

    await insertExperience(where, { name: 'Row 00 added later' });
    await client.db
      .update(experiences)
      .set({ status: 'paused' })
      .where(eq(experiences.id, hidden.id));

    const second = await list(filtersFor(where), first.nextCursor);
    expect(second.items.map(({ id }) => id)).toEqual(
      afterRows.slice(1).map(({ id }) => id),
    );
  });

  it('finds no row for a cursor that names an experience that is not there', async () => {
    const read = await browse.listBrowseExperiences(
      {
        filters: noFilters,
        after: '00000000-0000-4000-8000-0000000000aa',
      },
      asOf,
    );
    expect(read).toEqual({ cursor: null, items: [], nextCursor: null });
  });

  it('finds no row for a cursor that names a hidden experience, and reads no page', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'A live' });
    const paused = await insertExperience(where, { status: 'paused' });

    const read = await browse.listBrowseExperiences(
      { filters: filtersFor(where), after: paused.id },
      asOf,
    );

    expect(read).toEqual({ cursor: null, items: [], nextCursor: null });
  });

  it('returns the row a visible cursor names', async () => {
    const where = await scope();
    const live = await insertExperience(where, { name: 'A live' });

    const read = await browse.listBrowseExperiences(
      { filters: filtersFor(where), after: live.id },
      asOf,
    );

    expect(read.cursor).toEqual({ id: live.id, name: 'A live' });
  });
});

describe('covers', () => {
  async function insertPhoto(experienceId: string, position: number) {
    const id = randomUUID();
    await client.db.insert(photos).values({
      id,
      experienceId,
      position,
      storageKey: `public/photos/${experienceId}/${id}.jpg`,
      url: `https://store.example/${experienceId}/${String(position)}.jpg`,
      width: 1600,
      height: 1000,
      byteSize: 1000,
      decorative: true,
      blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      rightsBasis: 'ramble_owned',
    });
  }

  it('carries the lowest-position photo, and a null image for an experience with none', async () => {
    const where = await scope();
    const covered = await insertExperience(where, { name: 'A covered' });
    await insertPhoto(covered.id, 3);
    await insertPhoto(covered.id, 1);
    const bare = await insertExperience(where, { name: 'B bare' });

    const page = await list(filtersFor(where));

    expect(page.items.map(({ id }) => id)).toEqual([covered.id, bare.id]);
    expect(page.items[0]?.image).toEqual({
      src: `https://store.example/${covered.id}/1.jpg`,
      width: 1600,
      height: 1000,
      alt: '',
      blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    });
    expect(page.items[1]?.image).toBeNull();
  });
});

describe('category and neighborhood filters', () => {
  it('matches any value of a list', async () => {
    const one = await scope();
    const two = await scope();
    await insertExperience(one, { name: 'In one' });
    await insertExperience(two, { name: 'In two' });

    const page = await list({
      ...noFilters,
      categories: [one.category.slug, two.category.slug],
    });

    expect(names(page)).toEqual(['In one', 'In two']);
  });

  it('needs both the category and the neighborhood to match', async () => {
    const one = await scope();
    const other = await scope();
    await insertExperience(one, { name: 'Both' });
    await insertExperience(
      { ...one, neighborhood: other.neighborhood },
      { name: 'Wrong neighborhood' },
    );

    const page = await list({
      ...noFilters,
      categories: [one.category.slug],
      neighborhoods: [one.neighborhood.slug],
    });

    expect(names(page)).toEqual(['Both']);
  });

  it('matches nothing for a slug that does not exist', async () => {
    const where = await scope();
    await insertExperience(where);

    expect(
      (await list({ ...noFilters, categories: ['no-such-category'] })).items,
    ).toEqual([]);
  });
});
