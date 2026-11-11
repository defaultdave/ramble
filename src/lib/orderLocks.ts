// A path that starts from an order reads the session and hold ids it must lock without a lock, then
// takes the locks in their order (db/locks.ts). A move changes the session an order points at, so an
// order can move between that read and the order's own lock, and the locks taken would then be the
// old session's. These say whether the locks taken cover the order as it stands, and how often the
// path starts over before it gives up.

/** The most times a path starts over because the order moved under it; two moves in a row is already rare. */
export const lockRetryLimit = 3;

/**
 * Whether the locks taken (the session and hold read before them) are the ones the locked order
 * points at now. A missing order covers nothing: the path starts over and finds it gone.
 */
export function locksCoverOrder(
  taken: { sessionId: string; holdId: string },
  locked: { sessionId: string | null; holdId: string | null } | undefined,
): boolean {
  return (
    locked !== undefined &&
    locked.sessionId === taken.sessionId &&
    locked.holdId === taken.holdId
  );
}

export type LockedAttempt<T> = { kind: 'stale' } | { kind: 'done'; value: T };
