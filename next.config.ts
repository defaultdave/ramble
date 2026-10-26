import type { NextConfig } from 'next';
import { cacheProfiles } from './src/lib/cacheProfiles';
import { imageConfig } from './src/lib/images';
import { securityHeaders } from './src/lib/securityHeaders';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  // Next.js warns at build time when this is left unset beside cacheComponents.
  partialPrefetching: true,
  cacheLife: cacheProfiles,
  images: {
    ...imageConfig,
    formats: [...imageConfig.formats],
    qualities: [...imageConfig.qualities],
    deviceSizes: [...imageConfig.deviceSizes],
    imageSizes: [...imageConfig.imageSizes],
    remotePatterns: [...imageConfig.remotePatterns],
  },
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: [...securityHeaders] },
    ]);
  },
};

export default nextConfig;
