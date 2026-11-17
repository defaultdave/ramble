import type { Caller } from '@/server/auth/caller';
import { createFakeStorageAdapter } from '@/server/ports/storage/fake';
import { seedNow } from './authzFixtures';

// The seed and persona rows of the authorization matrix, kept apart so the matrix file stays under
// the size limit. Ops alone. These write the most, so the matrix lists them last.

const opsOnly = { platform: ['ops'] } as const;
const opsAndAdmin = { platform: ['ops', 'admin'] } as const;
const storage = createFakeStorageAdapter({ now: () => new Date() });

/** The modules load when a row runs, not when the rows are built: they read DATABASE_URL, which the matrix's beforeAll sets. */
export function seedRows() {
  return [
    {
      fn: 'seedPersonas',
      invoke: async (c) =>
        (await import('@/server/db/seed/personas')).seedPersonas(c),
      allows: opsOnly,
    },
    {
      fn: 'seedReviews',
      invoke: async (c) =>
        (await import('@/server/db/seed/reviews')).seedReviews(c, seedNow),
      allows: opsOnly,
    },
    // The test console's review invites: the console is a tester's tool, so admin is let in with ops.
    {
      fn: 'readInvitableOrderRows',
      invoke: async (c) =>
        (await import('@/server/db/reviews')).readInvitableOrderRows(c),
      allows: opsAndAdmin,
    },
    {
      fn: 'queueReviewInviteNow',
      invoke: async (c) =>
        (
          await import('@/server/jobs/reviewInviteSchedule')
        ).queueReviewInviteNow(c, '00000000-0000-4000-8000-000000000000'),
      allows: opsAndAdmin,
    },
    {
      fn: 'readSeedSnapshot',
      invoke: async (c) =>
        (await import('@/server/db/seed/read')).readSeedSnapshot(c, seedNow),
      allows: opsOnly,
    },
    {
      fn: 'readPhotoCoverageGaps',
      invoke: async (c) =>
        (await import('@/server/db/seed/photos')).readPhotoCoverageGaps(c),
      allows: opsOnly,
    },
    {
      fn: 'seedTestPhotos',
      invoke: async (c) =>
        (await import('@/server/db/seed/photos')).seedTestPhotos(c, storage),
      allows: opsOnly,
    },
    {
      fn: 'runSeed',
      invoke: async (c) =>
        (await import('@/server/db/seed/run')).runSeed({
          caller: c,
          now: seedNow,
        }),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
