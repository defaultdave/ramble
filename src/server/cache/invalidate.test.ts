import { revalidateTag, updateTag } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheChange } from '@/lib/cacheTags';
import { revalidateTagsForChanges, updateTagsForChanges } from './invalidate';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

const publishPick: CacheChange = { kind: 'pick', slug: 'summer' };
const publishGiftGuide: CacheChange = { kind: 'giftGuide' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateTagsForChanges', () => {
  it('updates each tag once, even when two changes share one', () => {
    updateTagsForChanges([publishPick, publishGiftGuide]);

    expect(vi.mocked(updateTag).mock.calls).toEqual([
      ['gift-guide'],
      ['home'],
      ['pick:summer'],
    ]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('does nothing for no changes', () => {
    updateTagsForChanges([]);

    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe('revalidateTagsForChanges', () => {
  it('revalidates each tag as stale-while-revalidate', () => {
    revalidateTagsForChanges([publishPick, publishPick]);

    expect(vi.mocked(revalidateTag).mock.calls).toEqual([
      ['home', 'max'],
      ['pick:summer', 'max'],
    ]);
    expect(updateTag).not.toHaveBeenCalled();
  });
});
