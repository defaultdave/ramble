import type { Caller } from '@/server/auth/caller';

// The experience-review row of the authorization matrix, kept apart so the matrix file stays under
// the size limit. The function is ops alone. The target is an experience that does not exist, so an
// ops caller is let through the guard and finds nothing to decide, and every other subject is refused.

type Target = { hostId: string; experienceId: string };

const opsOnly = { platform: ['ops'] } as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function experienceReviewRows() {
  return [
    {
      fn: 'decideExperienceReview',
      invoke: async (c, t) =>
        (await import('@/server/db/experienceReview')).decideExperienceReview(
          c,
          t.experienceId,
          { kind: 'reject', reason: 'other' },
        ),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller, target: Target) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
