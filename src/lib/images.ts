import { photoLimits } from './photos';

const oneYearSeconds = 31_536_000;

/**
 * `next/image` settings (ADR 0001, PRD-68). One format and one quality keep every photo to a
 * handful of cached variants, which matters because Hobby allows 5,000 transformations a month.
 * A stored photo never changes (a new upload gets a new id and key), so a served variant can be
 * cached for a year.
 */
export const imageConfig = {
  formats: ['image/webp'],
  qualities: [75],
  // Phone widths with a 3x screen first; the 2,400 px stored copy is the ceiling.
  deviceSizes: [640, 1080, 1440, 1920],
  // Cards and thumbnails.
  imageSizes: [160, 320, 480],
  minimumCacheTTL: oneYearSeconds,
  // Only public photos are optimised: the host name is the public store's, and the path is the
  // photo prefix, so a private document or any other host is refused by the optimiser.
  remotePatterns: [
    {
      protocol: 'https',
      hostname: '*.public.blob.vercel-storage.com',
      pathname: '/public/photos/**',
    },
  ],
  // The source is capped at what ingest can store, so the optimiser never fetches more.
  maximumResponseBody: photoLimits.maxStoredBytes,
  maximumRedirects: 0,
  dangerouslyAllowSVG: false,
  dangerouslyAllowLocalIP: false,
} as const;
