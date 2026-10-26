import { describe, expect, it } from 'vitest';
import { imageConfig } from './images';
import { photoLimits } from './photos';

describe('imageConfig', () => {
  it('serves one modern format at one quality', () => {
    expect(imageConfig.formats).toEqual(['image/webp']);
    expect(imageConfig.qualities).toHaveLength(1);
  });

  it('keeps the size lists short and within what ingest stores', () => {
    const sizes = [...imageConfig.deviceSizes, ...imageConfig.imageSizes];

    expect(imageConfig.deviceSizes.length).toBeLessThanOrEqual(5);
    expect(imageConfig.imageSizes.length).toBeLessThanOrEqual(4);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(photoLimits.storedEdge);
  });

  it('caches a variant for at least a month', () => {
    expect(imageConfig.minimumCacheTTL).toBeGreaterThanOrEqual(31 * 24 * 3600);
  });

  it('optimises only the public store, under the photo path', () => {
    expect(imageConfig.remotePatterns).toEqual([
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
        pathname: '/public/photos/**',
      },
    ]);
  });

  it('bounds what the optimiser fetches, follows no redirect, and refuses SVG and local addresses', () => {
    expect(imageConfig.maximumResponseBody).toBe(photoLimits.maxStoredBytes);
    expect(imageConfig.maximumRedirects).toBe(0);
    expect(imageConfig.dangerouslyAllowSVG).toBe(false);
    expect(imageConfig.dangerouslyAllowLocalIP).toBe(false);
  });
});
