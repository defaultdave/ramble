import { describe, expect, it } from 'vitest';
import { cacheProfiles } from '@/lib/cacheProfiles';
import nextConfig from '../../next.config';

describe('next.config', () => {
  it('registers the cacheLife profiles cached functions name', () => {
    expect(nextConfig.cacheLife).toEqual(cacheProfiles);
  });

  it('turns partial prefetching on beside cache components', () => {
    expect(nextConfig.cacheComponents).toBe(true);
    expect(nextConfig.partialPrefetching).toBe(true);
  });
});
