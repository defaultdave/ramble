import { presentText } from './displayText';
import { venueCity } from './venue';

/** The most of the meeting point's first sentence a Maps search takes; a longer one is no address. */
export const maxMapsQueryLength = 200;

/** Abbreviations whose full stop never ends a sentence: compass letters and titles or labels inside an address or a name. */
const innerAbbreviations = new Set(
  'w e n s ft mt mr mrs ms jr sr no apt fl ste'.split(' '),
);

/** Street suffixes. Most also read as a prefix ("St. Marks Pl", "Dr. Smith"), so the words around them decide. */
const streetSuffixes = new Set(
  'st ave blvd rd pl dr ln pkwy sq hwy'.split(' '),
);

/** Words that introduce a place, so a suffix right after one starts a name ("Near St. Marks Pl"). */
const leadInWords = new Set(
  'near at by to from behind outside opposite off of on past see visit meet'.split(
    ' ',
  ),
);

/**
 * Whether the word ending in a full stop ends the sentence, given the words either side. A
 * street suffix after a capitalised word or a number does ("Hudson St. The door"). Pinned
 * limit: "Hudson St. A door" does not end, since a single letter reads as "Ave. B".
 */
function fullStopEndsSentence(
  token: string,
  previous: string | undefined,
  next: string | undefined,
): boolean {
  const word = token.slice(0, -1).toLowerCase();
  if (innerAbbreviations.has(word)) return false;
  if (next !== undefined && /^\p{Ll}/u.test(next)) return false;
  if (!streetSuffixes.has(word)) return true;
  if (next !== undefined) {
    const nextWord = /^[\p{L}\p{N}]*/u.exec(next)?.[0] ?? '';
    if (nextWord.length === 1 && /\p{L}/u.test(nextWord)) return false;
  }
  if (previous === undefined) return false;
  const isPrefix =
    /^\p{Ll}/u.test(previous) ||
    previous.endsWith(',') ||
    leadInWords.has(previous.toLowerCase());
  return !isPrefix;
}

/**
 * A Maps search for the meeting point (PRD-09), or null when there is none or its first sentence
 * is too long to be an address. Only the first sentence is searched: what follows ("The exact
 * door is in your confirmation.") is a note to the guest, not a place. A newline, "! " or "? "
 * ends the sentence; so does a full stop, except after an abbreviation that belongs inside an
 * address ("W. 23rd St. The door..." ends at "St", but "St. Marks Pl" and "Ave. B" go on).
 */
export function mapsHref(meetingPoint: string | null): string | null {
  const text = presentText(meetingPoint);
  if (text === null) return null;
  // Whitespace can shrink when collapsed, so the walk may read twice the limit before giving up.
  const windowText = text.slice(0, maxMapsQueryLength * 2);
  const newline = windowText.indexOf('\n');
  const line = newline < 0 ? windowText : windowText.slice(0, newline);
  const tokens = Array.from(line.matchAll(/\S+/g));
  let end = -1;
  for (const [i, { 0: token, index }] of tokens.entries()) {
    const last = token.at(-1);
    const stop =
      last === '!' ||
      last === '?' ||
      (last === '.' &&
        fullStopEndsSentence(token, tokens[i - 1]?.[0], tokens[i + 1]?.[0]));
    if (stop) {
      end = index + token.length - 1;
      break;
    }
  }
  if (end < 0) {
    if (newline < 0 && text.length > windowText.length) return null;
    end = line.length;
  }
  const first = line
    .slice(0, end)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
  if (first === '' || first.length > maxMapsQueryLength) return null;
  const query = encodeURIComponent(`${first}, ${venueCity}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}
