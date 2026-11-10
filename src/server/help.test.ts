import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tags } from '@/lib/cacheTags';
import { getHelpArticle, getHelpIndex, searchHelp } from './help';

// Behaviours under test, one per decision, branch or risk:
// - each cached read names the editorial profile and tags itself with the help-articles tag, the tag a save invalidates
// - an article that is not there is a plain null, read through the same cached path
// - a failed read throws only the kind of the failure, never the query or its values
// - the search is not cached: it touches neither the profile nor a tag

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheLife: cache.life,
  cacheTag: cache.tag,
}));

const db = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  search: vi.fn(),
}));
vi.mock('@/server/db/editorial', () => ({
  listPublishedHelpArticles: db.list,
  getPublishedHelpArticle: db.get,
}));
vi.mock('@/server/db/help', () => ({ searchPublishedHelpArticles: db.search }));

const summary = { id: '1', slug: 'a', title: 'A', summary: null };
const driverError = new Error('Failed query: select ... params: secret-slug');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getHelpIndex', () => {
  it('uses the editorial profile and tags the help articles', async () => {
    db.list.mockResolvedValue([summary]);

    await expect(getHelpIndex()).resolves.toEqual([summary]);

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('editorial');
    expect(cache.tag).toHaveBeenCalledExactlyOnceWith(tags.helpArticles);
  });

  it('throws only the kind of a failed read', async () => {
    db.list.mockRejectedValue(driverError);

    const failure = await getHelpIndex().catch((error: unknown) => error);

    expect(failure).toMatchObject({ message: 'Help index read failed: Error' });
    expect(JSON.stringify(failure)).not.toContain('secret-slug');
  });
});

describe('getHelpArticle', () => {
  it('uses the editorial profile and tags the help articles', async () => {
    db.get.mockResolvedValue({ slug: 'a' });

    await expect(getHelpArticle('a')).resolves.toEqual({ slug: 'a' });

    expect(db.get).toHaveBeenCalledExactlyOnceWith('a');
    expect(cache.life).toHaveBeenCalledExactlyOnceWith('editorial');
    expect(cache.tag).toHaveBeenCalledExactlyOnceWith(tags.helpArticles);
  });

  it('answers null for an article that is not there, with the same profile and tag', async () => {
    db.get.mockResolvedValue(null);

    await expect(getHelpArticle('gone')).resolves.toBeNull();

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('editorial');
    expect(cache.tag).toHaveBeenCalledExactlyOnceWith(tags.helpArticles);
  });

  it('throws only the kind of a failed read', async () => {
    db.get.mockRejectedValue(driverError);

    const failure = await getHelpArticle('a').catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'Help article read failed: Error',
    });
    expect(JSON.stringify(failure)).not.toContain('secret-slug');
  });
});

describe('searchHelp', () => {
  it('reads the search without the cache', async () => {
    db.search.mockResolvedValue([summary]);

    await expect(searchHelp('cancel')).resolves.toEqual([summary]);

    expect(db.search).toHaveBeenCalledExactlyOnceWith('cancel');
    expect(cache.life).not.toHaveBeenCalled();
    expect(cache.tag).not.toHaveBeenCalled();
  });
});
