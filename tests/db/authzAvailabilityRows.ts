import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/auth/caller';

// The availability rows of the authorization matrix, kept apart so the matrix file stays under the
// size limit. Every function here is ops alone. The experience and the slot are ids no row has, so
// an ops caller is let through the guard and finds nothing to write, and every other subject is
// refused. A real experience would let the ops row add slots and sessions the other rows count.

type Target = { hostId: string; experienceId: string };

const opsOnly = { platform: ['ops'] } as const;

/** The module loads when a row runs, not when the rows are built: it reads DATABASE_URL, which the matrix's beforeAll sets. */
export function availabilityRows() {
  const availability = () => import('@/server/db/availability');
  return [
    {
      fn: 'readAvailability',
      invoke: async (c) =>
        (await availability()).readAvailability(c, randomUUID(), new Date()),
      allows: opsOnly,
    },
    {
      fn: 'addWeeklySlots',
      invoke: async (c) =>
        (await availability()).addWeeklySlots(c, {
          experienceId: randomUUID(),
          weekdays: [2],
          startTime: '10:00',
          durationMinutes: 60,
          allocation: 4,
          source: 'ramble',
        }),
      allows: opsOnly,
    },
    {
      fn: 'updateSlotSeats',
      invoke: async (c) =>
        (await availability()).updateSlotSeats(c, {
          templateId: randomUUID(),
          allocation: 3,
        }),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller, target: Target) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
