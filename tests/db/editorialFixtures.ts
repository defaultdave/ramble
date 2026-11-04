import type { CollectionInput, HelpArticleInput } from '@/lib/editorial';
import type { db as Db } from '@/server/db/client';
import type { experiences } from '@/server/db/schema';
import { catalogFixtures, unique, type Parents } from './catalogFixtures';

type Database = typeof Db;

export function doc(text = 'Hello') {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  } as never;
}

export async function insertOne<T>(rows: Promise<T[]>): Promise<T> {
  const [row] = await rows;
  if (!row) throw new Error('insert returned no row');
  return row;
}

export function collectionInput(
  overrides: Partial<CollectionInput> = {},
): CollectionInput {
  return {
    kind: 'pick',
    slug: unique('pick'),
    title: 'A pick',
    summary: null,
    intro: null,
    status: 'draft',
    items: [],
    ...overrides,
  };
}

export function helpInput(
  overrides: Partial<HelpArticleInput> = {},
): HelpArticleInput {
  return {
    slug: unique('help'),
    title: 'How do I cancel?',
    summary: null,
    position: 0,
    status: 'draft',
    body: doc(),
    ...overrides,
  };
}

export async function saved<T extends { status: string }>(
  result: Promise<T>,
): Promise<Extract<T, { status: 'saved' | 'published' }>> {
  const outcome = await result;
  if (outcome.status !== 'saved' && outcome.status !== 'published') {
    throw new Error(`Expected a save, got ${outcome.status}`);
  }
  return outcome as Extract<T, { status: 'saved' | 'published' }>;
}

/** Catalog inserts for the editorial reads, with one host and one pair of parents shared by the file. */
export function editorialFixtures(getDb: () => Database) {
  const catalog = catalogFixtures(getDb);
  let sharedParents: Promise<Parents> | undefined;

  const insertCategory = (slug = unique('category')) =>
    catalog.insertCategory({ slug, name: slug });

  const insertNeighborhood = (slug = unique('neighborhood')) =>
    catalog.insertNeighborhood({ slug, name: slug });

  function parents(): Promise<Parents> {
    sharedParents ??= (async () => {
      const host = await catalog.insertHost({ name: 'Host' });
      return {
        hostId: host.id,
        categoryId: (await insertCategory()).id,
        neighborhoodId: (await insertNeighborhood()).id,
        cancellationTierId: await catalog.defaultTierId(),
      };
    })();
    return sharedParents;
  }

  async function insertExperience(
    status: 'draft' | 'live' | 'paused' = 'live',
    overrides: Partial<typeof experiences.$inferInsert> = {},
  ) {
    return catalog.insertExperience(await parents(), { status, ...overrides });
  }

  return { insertCategory, insertNeighborhood, parents, insertExperience };
}
