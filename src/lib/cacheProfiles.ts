export type CacheProfile = {
  /** Seconds the browser's router cache may reuse the result without asking the server. */
  stale: number;
  /** Seconds before the server serves the entry while it refreshes it in the background. */
  revalidate: number;
  /** Seconds after which the entry is dropped and the next request waits for a fresh read. */
  expire: number;
};

// Tags are how a publish or a booking change reaches a cached entry (cacheTags.ts). These times
// are the backstop for a missed invalidation, so they are long for content that staff edit and
// short for content that guests change. `next.config.ts` registers them, and a cached function
// names one of them in `cacheLife('<name>')`; the convention test rejects any other name.
//
// Next.js leaves an entry whose `expire` is under five minutes out of the prerendered shell and
// streams it instead. That is what the spaces-left read needs, and why it must reserve its space.
export const cacheProfiles = {
  /** Home modules, Picks, gift guide, category and neighborhood copy, help articles, legal documents. */
  editorial: { stale: 300, revalidate: 3_600, expire: 86_400 },
  /** The experience and guide shells and the two catalog indexes the listings filter in memory. */
  catalog: { stale: 300, revalidate: 900, expire: 86_400 },
  /** Browse results for one filter combination. */
  browse: { stale: 30, revalidate: 60, expire: 600 },
  /** The site banner and other ops switches that guest pages show. */
  settings: { stale: 60, revalidate: 300, expire: 3_600 },
  /** Spaces left for one session, read through the runtime cache. Postgres decides at reserve. */
  spacesLeft: { stale: 5, revalidate: 8, expire: 60 },
} as const satisfies Record<string, CacheProfile>;
