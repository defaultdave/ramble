import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { editorialLimits, picksCandidates } from './editorial';

/** Cards in one Ramble Picks module; the rest are behind its "See all" link. */
export const picksShown = 3;

/** Cards in the "On this week" module. */
export const thisWeekShown = 4;

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
 * A list of at most `max` IDs. Two stages, because a single `z.array(EntityIdSchema).max(max)`
 * parses every element before it looks at the length, so a huge list costs a huge parse. The first
 * stage refuses a list that is too long on its length alone; only a list within the bound reaches
 * the ID check.
 */
export function idListSchema(max: number) {
  const withinBound = z.array(z.unknown()).max(max);
  return withinBound.pipe(z.array(EntityIdSchema));
}
