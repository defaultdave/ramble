import type { NextConfig } from 'next';

const config: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // FAILING_REMOTE=1 swaps in a remote handler that throws, to see degraded behavior.
  ...(process.env.FAILING_REMOTE
    ? { cacheHandlers: { remote: require.resolve('./cache-handlers/failing.js') } }
    : {}),
};
export default config;
