import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { editorialLimits } from './editorial';

/** Cards in one Ramble Picks module; the rest are behind its "See all" link. */
export const picksShown = 3;

/** Cards in the "On this week" module. */
export const thisWeekShown = 4;

/**
 * Entries of one collection the home page looks at to find `picksShown` cards, in case some cannot
 * be shown. The most the tag budget leaves room for (`cacheTagBudget.test.ts` fails if it grows): every
 * candidate is one cache tag on the home entry.
 */
export const picksCandidates = 5;

/**
 * The experiences one card read looks up by ID, and so the tags of the home entry: the most the
 * home page can list, every module with `picksCandidates` entries.
 */
export const cardLookupLimit = editorialLimits.homeModules * picksCandidates;

/**
 * The experiences one batch read of cover photos takes: the cards the home page draws, every module
 * showing as many as its kind shows. The covers are asked for after the cards are built, so this is
 * the cards shown and not the candidates looked at.
 */
export const coverLookupLimit =
  editorialLimits.homeModules * Math.max(picksShown, thisWeekShown);

/**
 * A list of at most `max` IDs. The length is checked before any ID is, as Zod checks every ID of
 * an array even when the array is already too long.
 */
export function idListSchema(max: number) {
  return z.array(z.unknown()).max(max).pipe(z.array(EntityIdSchema));
}
