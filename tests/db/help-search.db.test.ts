import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { unique } from './catalogFixtures';
import { helpInput, saved } from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - the search matches a title anywhere in it, ignoring case, and returns published articles only
// - results keep the order of the index and carry no body
// - %, _ and \ in a term match themselves and nothing else
// - a term that matches nothing returns an empty list

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');
let help: typeof import('@/server/db/help');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
  help = await import('@/server/db/help');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const ops = testCaller({ roles: [Role.Ops] });
const publish = (title: string, position: number, status = 'published') =>
  saved(
    editorial.saveHelpArticle(
      ops,
      helpInput({
        slug: unique('help-search'),
        title,
        position,
        status: status as 'published' | 'draft',
      }),
    ),
  );
const titles = async (term: string) =>
  (await help.searchPublishedHelpArticles(term)).map((a) => a.title);

describe('searchPublishedHelpArticles', () => {
  it('matches a title anywhere in it without regard to case, in index order, and leaves out drafts', async () => {
    await publish('Zed: how to CANCEL a booking', 2);
    await publish('Cancel in a hurry', 1);
    await publish('Cancel a draft', 0, 'draft');
    await publish('Something else', 3);

    const found = await help.searchPublishedHelpArticles('cancel');

    expect(found.map((a) => a.title)).toEqual([
      'Cancel in a hurry',
      'Zed: how to CANCEL a booking',
    ]);
    expect(found[0]).not.toHaveProperty('body');
  });

  it('takes percent, underscore and backslash literally', async () => {
    await publish('Save 100% on a gift', 10);
    await publish('Save 1000 on a gift', 11);
    await publish('Under_score rules', 12);
    await publish('UnderXscore rules', 13);
    await publish('Back\\slash path', 14);

    expect(await titles('100%')).toEqual(['Save 100% on a gift']);
    expect(await titles('%')).toEqual(['Save 100% on a gift']);
    expect(await titles('Under_score')).toEqual(['Under_score rules']);
    expect(await titles('_')).toEqual(['Under_score rules']);
    expect(await titles('Back\\slash')).toEqual(['Back\\slash path']);
  });

  it('is empty when nothing matches', async () => {
    expect(await titles('no article is called this')).toEqual([]);
  });
});
