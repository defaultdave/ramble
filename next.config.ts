import { withBotId } from 'botid/next/config';
import type { NextConfig } from 'next';
import { cacheProfiles } from './src/lib/cacheProfiles';
import { imageConfigFor } from './src/lib/images';
import { securityHeaders } from './src/lib/securityHeaders';
import { publicStoreIdFromToken } from './src/lib/storage';

// This file runs outside the app, before the validated environment module can, so it reads the two
// variables directly. Unset, or any provider but vercel-blob, leaves no remote image host allowed.
const publicToken =
  process.env.STORAGE_PROVIDER === 'vercel-blob'
    ? process.env.BLOB_PUBLIC_READ_WRITE_TOKEN
    : undefined;
const publicStoreId = publicToken ? publicStoreIdFromToken(publicToken) : null;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  // Next.js warns at build time when this is left unset beside cacheComponents.
  partialPrefetching: true,
  cacheLife: cacheProfiles,
  images: imageConfigFor(publicStoreId),
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: [...securityHeaders] },
    ]);
  },
};

// Adds the rewrites that carry BotID's challenge through the site's own origin (ADR 0007).
export default withBotId(nextConfig);
