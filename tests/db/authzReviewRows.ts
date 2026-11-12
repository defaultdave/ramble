import type { Caller } from '@/server/auth/caller';
import { availabilityRows } from './authzAvailabilityRows';
import { hostSettingsRows } from './authzHostSettingsRows';
import { experiencePauseRows } from './authzPauseRows';

// The experience-review row of the authorization matrix, kept apart so the matrix file stays under
// the size limit. The function is ops alone. The target is an experience that does not exist, so an
// ops caller is let through the guard and finds nothing to decide, and every other subject is refused.

type Target = { hostId: string; experienceId: string };

const opsOnly = { platform: ['ops'] } as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function experienceReviewRows() {
  return [
    ...availabilityRows(),
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
    // The matrix file is at its size limit, so the pause and host settings rows ride with the review rows.
    ...experiencePauseRows(),
    ...hostSettingsRows(),
  ] satisfies {
    fn: string;
    invoke: (caller: Caller, target: Target) => Promise<unknown>;
    allows: Partial<Record<string, readonly string[]>>;
  }[];
}
