import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { editorialLimits } from './editorial';

/** Entries of one collection the home page looks at to find the cards a Picks module shows. */
export const picksCandidates = 12;

/**
 * The experiences one card read looks up by ID, and so the cover photos one batch read takes: the
 * most the home page can list, every module with `picksCandidates` entries.
 */
export const cardLookupLimit = editorialLimits.homeModules * picksCandidates;

/**
 * A list of at most `max` IDs. The length is checked before any ID is, as Zod checks every ID of
 * an array even when the array is already too long.
 */
export function idListSchema(max: number) {
  return z.array(z.unknown()).max(max).pipe(z.array(EntityIdSchema));
}
