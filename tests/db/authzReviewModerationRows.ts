import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/auth/caller';

// The review-moderation rows of the authorization matrix. Both functions are ops alone; a missing
// review is not found for ops and refused to everyone else.

const opsOnly = { platform: ['ops'] } as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function reviewModerationRows() {
  return [
    {
      fn: 'readReviewsForModeration',
      invoke: async (c) =>
        (await import('@/server/db/reviewModeration')).readReviewsForModeration(
          c,
          { status: null, cursor: null },
        ),
      allows: opsOnly,
    },
    {
      fn: 'setReviewVisibility',
      invoke: async (c) =>
        (await import('@/server/db/reviewModeration')).setReviewVisibility(c, {
          action: 'hide',
          id: randomUUID(),
          reason: 'spam',
        }),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
