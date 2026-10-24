import type { NextConfig } from 'next';
import { cacheProfiles } from './src/lib/cacheProfiles';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,
  // Next.js warns at build time when this is left unset beside cacheComponents.
  partialPrefetching: true,
  cacheLife: cacheProfiles,
};

export default nextConfig;
