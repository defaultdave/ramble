import { photoLimits } from './photos';

const oneYearSeconds = 31_536_000;

/**
 * `next/image` settings (ADR 0001, PRD-68). One format and one quality keep every photo to a
 * handful of cached variants, which matters because Hobby allows 5,000 transformations a month.
 * A stored photo never changes (a new upload gets a new id and key), so a served variant can be
 * cached for a year.
 *
 * `publicStoreId` is Ramble's own public Blob store (see `publicStoreIdFromToken`). It is read when
 * the app is built, so a different store needs a new deployment.
 */
export function imageConfigFor(publicStoreId: string | null) {
  return {
    formats: ['image/webp' as const],
    qualities: [75],
    // Phone widths with a 3x screen first; the 2,400 px stored copy is the ceiling.
    deviceSizes: [640, 1080, 1440, 1920],
    // Cards and thumbnails.
    imageSizes: [160, 320, 480],
    minimumCacheTTL: oneYearSeconds,
    // Only Ramble's own store and only its photo path may be optimised. A wildcard host would let
    // anyone point /_next/image at their own store and spend the transformation quota. With no
    // store (the fake provider) nothing remote is fetched.
    remotePatterns: publicStoreId
      ? [
          {
            protocol: 'https' as const,
            hostname: `${publicStoreId}.public.blob.vercel-storage.com`,
            pathname: '/public/photos/**',
          },
        ]
      : [],
    // The source is capped at what ingest can store, so the optimiser never fetches more.
    maximumResponseBody: photoLimits.maxStoredBytes,
    maximumRedirects: 0,
    dangerouslyAllowSVG: false,
    dangerouslyAllowLocalIP: false,
  };
}
