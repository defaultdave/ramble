import { matchRemotePattern } from 'next/dist/shared/lib/match-remote-pattern';
import { describe, expect, it } from 'vitest';
import { imageConfigFor } from '@/lib/images';
import { photoLimits } from '@/lib/photos';

const ours = imageConfigFor('ramblestore1');
const allowed = (config: ReturnType<typeof imageConfigFor>, url: string) =>
  config.remotePatterns.some((pattern) =>
    matchRemotePattern(pattern, new URL(url)),
  );

describe('imageConfigFor', () => {
  it('serves one modern format at one quality', () => {
    expect(ours.formats).toEqual(['image/webp']);
    expect(ours.qualities).toHaveLength(1);
  });

  it('keeps the size lists short and within what ingest stores', () => {
    const sizes = [...ours.deviceSizes, ...ours.imageSizes];

    expect(ours.deviceSizes.length).toBeLessThanOrEqual(5);
    expect(ours.imageSizes.length).toBeLessThanOrEqual(4);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(photoLimits.storedEdge);
  });

  it('caches a variant for at least a month', () => {
    expect(ours.minimumCacheTTL).toBeGreaterThanOrEqual(31 * 24 * 3600);
  });

  describe('remote hosts', () => {
    const photo = 'public/photos/exp/photo.jpg';

    it('optimises a photo from our own public store', () => {
      expect(
        allowed(
          ours,
          `https://ramblestore1.public.blob.vercel-storage.com/${photo}`,
        ),
      ).toBe(true);
    });

    it.each([
      [
        "another customer's public store",
        `https://someoneelse.public.blob.vercel-storage.com/${photo}`,
      ],
      [
        'a host that only ends with our store id',
        `https://xramblestore1.public.blob.vercel-storage.com/${photo}`,
      ],
      [
        'a subdomain of our store host',
        `https://evil.ramblestore1.public.blob.vercel-storage.com/${photo}`,
      ],
      [
        'our private store',
        `https://ramblestore1.private.blob.vercel-storage.com/${photo}`,
      ],
      [
        'a path outside the photo prefix',
        'https://ramblestore1.public.blob.vercel-storage.com/other/a.jpg',
      ],
      [
        'a private document path',
        'https://ramblestore1.public.blob.vercel-storage.com/private/documents/a.pdf',
      ],
      [
        'plain http',
        `http://ramblestore1.public.blob.vercel-storage.com/${photo}`,
      ],
      ['an unrelated host', `https://example.com/${photo}`],
    ])('refuses %s', (_name, url) => {
      expect(allowed(ours, url)).toBe(false);
    });

    it('allows no remote host without a store, as with the fake provider', () => {
      const none = imageConfigFor(null);

      expect(none.remotePatterns).toEqual([]);
      expect(
        allowed(
          none,
          `https://ramblestore1.public.blob.vercel-storage.com/${photo}`,
        ),
      ).toBe(false);
    });

    it.each([ours, imageConfigFor('abc123'), imageConfigFor(null)])(
      'never uses a wildcard in a hostname',
      (config) => {
        for (const pattern of config.remotePatterns) {
          expect(pattern.hostname).not.toContain('*');
        }
      },
    );
  });

  it('bounds what the optimiser fetches, follows no redirect, and refuses SVG and local addresses', () => {
    expect(ours.maximumResponseBody).toBe(photoLimits.maxStoredBytes);
    expect(ours.maximumRedirects).toBe(0);
    expect(ours.dangerouslyAllowSVG).toBe(false);
    expect(ours.dangerouslyAllowLocalIP).toBe(false);
  });
});
