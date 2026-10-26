import type { NextConfig } from 'next';
import { cacheProfiles } from './src/lib/cacheProfiles';
import { securityHeaders } from './src/lib/securityHeaders';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  // Next.js warns at build time when this is left unset beside cacheComponents.
  partialPrefetching: true,
  cacheLife: cacheProfiles,
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: [...securityHeaders] },
    ]);
  },
};

export default nextConfig;
