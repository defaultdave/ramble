import { randomUUID } from 'node:crypto';
import { newExperienceValues } from '@/lib/experienceEditor';
import type { Caller } from '@/server/auth/caller';

// The experience-editor rows of the authorization matrix, kept apart so the matrix file stays under the size limit.
// Every function here is ops alone. The target is a host and an experience that do not exist, so an
// ops caller is let through the guard and finds nothing to write, and every other subject is refused.

type Target = { hostId: string; experienceId: string };

const opsOnly = { platform: ['ops'] } as const;

/** The modules load when a row runs, not when the rows are built: they read DATABASE_URL, which the matrix's beforeAll sets. */
export function experienceEditorRows() {
  const content = () =>
    newExperienceValues({
      categoryId: randomUUID(),
      neighborhoodId: randomUUID(),
      cancellationTierId: randomUUID(),
    });
  const editor = () => import('@/server/db/experienceEditor');
  return [
    {
      fn: 'readExperiencesForOps',
      invoke: async (c) =>
        (await editor()).readExperiencesForOps(
          c,
          { status: null, hostId: null, categoryId: null },
          null,
        ),
      allows: opsOnly,
    },
    {
      fn: 'readExperienceChoices',
      invoke: async (c) => (await editor()).readExperienceChoices(c),
      allows: opsOnly,
    },
    {
      fn: 'readExperienceForOps',
      invoke: async (c, t) =>
        (await editor()).readExperienceForOps(c, t.experienceId),
      allows: opsOnly,
    },
    {
      fn: 'createExperience',
      invoke: async (c, t) =>
        (await editor()).createExperience(c, {
          ...content(),
          hostId: t.hostId,
          name: 'Matrix experience',
          slug: 'matrix-experience',
        }),
      allows: opsOnly,
    },
    {
      fn: 'updateExperience',
      invoke: async (c, t) =>
        (await editor()).updateExperience(c, t.experienceId, {
          ...content(),
          name: 'Renamed',
          slug: 'renamed',
        }),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller, target: Target) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
