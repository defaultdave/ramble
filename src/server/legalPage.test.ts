import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tagsForChanges } from '@/lib/cacheTags';
import { legalChange, type LegalDocument } from '@/lib/legal';
import { blocks } from '@/lib/seed/richText';
import { getLegalPage } from './legalPage';

// Behaviours under test, one per decision, branch or risk:
// - a hit reads on the editorial profile and is tagged with the tag a legal publish invalidates
// - a miss ends on the uncached profile, so made-up keys fill nothing
// - a malformed key reads nothing, is not tagged, and ends on the uncached profile
// - a failed read throws only the kind of the failure, never the query or its values

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({ cacheLife: cache.life, cacheTag: cache.tag }));

const db = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock('@/server/db/legal', () => ({ getCurrentLegalDocument: db.current }));

const document: LegalDocument = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  doc: 'terms',
  version: 1,
  title: 'Terms of service',
  body: blocks('Demo text.'),
  status: 'published',
  publishedAt: new Date('2026-11-01T12:00:00Z'),
  createdAt: new Date('2026-10-31T12:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  db.current.mockResolvedValue(document);
});

describe('getLegalPage', () => {
  it.each(['terms', 'waiver-hudson-paddle-club'])(
    'reads %s on the editorial profile under the tag a publish invalidates',
    async (doc) => {
      await expect(getLegalPage(doc)).resolves.toBe(document);

      expect(db.current).toHaveBeenCalledExactlyOnceWith(doc);
      expect(cache.life).toHaveBeenCalledExactlyOnceWith('editorial');
      expect(cache.tag).toHaveBeenCalledExactlyOnceWith(
        ...tagsForChanges([legalChange(doc)]),
      );
    },
  );

  it('ends a miss on the uncached profile', async () => {
    db.current.mockResolvedValue(null);

    await expect(getLegalPage('privacy')).resolves.toBeNull();

    expect(cache.tag).toHaveBeenCalledExactlyOnceWith('legal:privacy');
    expect(cache.life).toHaveBeenLastCalledWith('uncached');
  });

  it.each(['', 'sample', 'Terms', 'waiver-', 'a'.repeat(300)])(
    'reads nothing for the key %j, tags nothing, and keeps nothing',
    async (doc) => {
      await expect(getLegalPage(doc)).resolves.toBeNull();

      expect(db.current).not.toHaveBeenCalled();
      expect(cache.tag).not.toHaveBeenCalled();
      expect(cache.life).toHaveBeenLastCalledWith('uncached');
    },
  );

  it('throws only the kind of a failed read', async () => {
    db.current.mockRejectedValue(
      new Error('Failed query: select ... params: secret-id'),
    );

    const failure = await getLegalPage('terms').catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({
      message: 'Legal document read failed: Error',
    });
    expect(String(failure)).not.toMatch(/secret|Failed query/);
  });
});
