import { describe, expect, it } from 'vitest';
import { cacheProfiles } from './cacheProfiles';

describe('cacheProfiles', () => {
  it.each(Object.entries(cacheProfiles))(
    '%s keeps stale within revalidate within expire',
    (_name, { stale, revalidate, expire }) => {
      expect(stale).toBeLessThanOrEqual(revalidate);
      expect(revalidate).toBeLessThanOrEqual(expire);
    },
  );

  it('keeps spaces left short enough to be streamed, not prerendered', () => {
    expect(cacheProfiles.spacesLeft.expire).toBeLessThan(300);
  });

  it('lets nothing live for the uncached profile', () => {
    expect(cacheProfiles.uncached).toEqual({
      stale: 0,
      revalidate: 0,
      expire: 0,
    });
  });
});
