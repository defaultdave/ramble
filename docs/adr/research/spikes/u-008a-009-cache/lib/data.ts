import { cacheLife, cacheTag } from 'next/cache';

let calls = { stamp: 0, remote: 0, spaces: 0 };
export const counters = () => calls;

// Cached function: reports when it ran, so a hit and a miss can be told apart.
export async function getStamp(tag: string) {
  'use cache';
  cacheTag(tag);
  cacheLife({ stale: 30, revalidate: 3600, expire: 86400 });
  calls.stamp++;
  return { ranAt: new Date().toISOString(), run: calls.stamp };
}

// Short-lived runtime-cache read, like "spaces left" (ADR 0001).
export async function getSpacesLeft(sessionId: string) {
  'use cache: remote';
  cacheTag(`session-${sessionId}`);
  cacheLife({ stale: 5, revalidate: 8, expire: 60 });
  calls.remote++;
  return { left: 10 - (calls.remote % 10), ranAt: new Date().toISOString(), run: calls.remote };
}
