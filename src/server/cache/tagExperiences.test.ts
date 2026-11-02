import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tagExperiences } from './tagExperiences';

const cache = vi.hoisted(() => ({ tag: vi.fn() }));
vi.mock('next/cache', () => ({ cacheTag: cache.tag }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tagExperiences', () => {
  it('tags the entry once per experience, so no single call passes the 128-tag cut', () => {
    tagExperiences(['e1', 'e2']);

    expect(cache.tag.mock.calls).toEqual([
      ['experience:e1'],
      ['experience:e2'],
    ]);
  });

  it('tags nothing for no experiences', () => {
    tagExperiences([]);

    expect(cache.tag).not.toHaveBeenCalled();
  });
});
