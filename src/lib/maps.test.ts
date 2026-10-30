import { describe, expect, it } from 'vitest';
import { mapsHref, maxMapsQueryLength } from './maps';

describe('mapsHref', () => {
  it('searches the first sentence of the meeting point, in New York', () => {
    expect(
      mapsHref(
        'Pier 26 boathouse, Tribeca. The exact door is in your confirmation.',
      ),
    ).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Pier 26 boathouse, Tribeca, New York')}`,
    );
  });

  it('drops the full stop of a single sentence', () => {
    expect(mapsHref('Wheelhouse Kids Studio, Williamsburg.')).toContain(
      encodeURIComponent('Wheelhouse Kids Studio, Williamsburg, New York'),
    );
  });

  it('encodes what would otherwise end the query', () => {
    expect(mapsHref('A&B #1')).toContain(
      encodeURIComponent('A&B #1, New York'),
    );
  });

  const searchFor = (place: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place}, New York`)}`;

  it.each([
    ['W. 23rd St. The door is on the left.', 'W. 23rd St'],
    ['St. Marks Pl', 'St. Marks Pl'],
    ['St. Marks Pl. Ring the bell.', 'St. Marks Pl'],
    ['Meet at St. Marks Pl', 'Meet at St. Marks Pl'],
    ['Meet at St. Marks Pl. Ring the bell.', 'Meet at St. Marks Pl'],
    ['Near St. Marks Pl', 'Near St. Marks Pl'],
    ['Pier 57, St. Johns Pl', 'Pier 57, St. Johns Pl'],
    ['Hudson St. The door is on the left.', 'Hudson St'],
    ['Park Ave. Meet at the gate.', 'Park Ave'],
    ['Union Sq. Meet at the fountain.', 'Union Sq'],
    ['Meet at Gate B. The desk is open.', 'Meet at Gate B'],
    ['Bleecker St. and Mott St. Ring bell.', 'Bleecker St. and Mott St'],
    ['Ave. B and E 4th St.', 'Ave. B and E 4th St'],
    // Pinned limit: a single letter after a street reads as "Ave. B", so the note stays in.
    ['Hudson St. A door', 'Hudson St. A door'],
    ['Ave. B', 'Ave. B'],
    ['Pier 26. A guide will wait there.', 'Pier 26'],
    ['The Cloisters. A staff member opens at 9.', 'The Cloisters'],
    ["Central Park Zoo. I'm in a red hat.", 'Central Park Zoo'],
    ['Pier 26. 5 minutes early please', 'Pier 26'],
    ['Pier 26. 4 people wait.', 'Pier 26'],
    ['Park Ave. 5 is closed', 'Park Ave'],
    ['Ave. 5 is closed', 'Ave. 5 is closed'],
    // Pinned limit: a lowercase next word reads as the same sentence, so this note stays in.
    ['Hudson St. use the side door', 'Hudson St. use the side door'],
    ['Meet at 10 Ave. B', 'Meet at 10 Ave. B'],
    ['Pier 57, 25 11th Ave. Meet at the gate.', 'Pier 57, 25 11th Ave'],
    ['Gate 5. Meet at the sign.', 'Gate 5'],
    ['Pier 26! Look for the flag.', 'Pier 26'],
    ['Where is it? Pier 26.', 'Where is it'],
    [
      'Pier 26, Tribeca\nThe exact door is in your confirmation.',
      'Pier 26, Tribeca',
    ],
    ['Pier 26, \t Tribeca. Ring the bell.', 'Pier 26, Tribeca'],
    ['Pier   26 \t Tribeca', 'Pier 26 Tribeca'],
    ['123 Main St.', '123 Main St'],
  ])('searches the first real sentence of %j', (text, place) => {
    expect(mapsHref(text)).toBe(searchFor(place));
  });

  it('refuses a first sentence that is long before whitespace collapses, without walking on', () => {
    expect(mapsHref(`${'a '.repeat(maxMapsQueryLength * 2)}end.`)).toBeNull();
  });

  it.each([null, '', '   ', '. Only a note'])('makes none for %j', (text) => {
    expect(mapsHref(text)).toBeNull();
  });

  it('takes a first sentence at the limit and refuses one past it', () => {
    expect(mapsHref('a'.repeat(maxMapsQueryLength))).not.toBeNull();
    expect(mapsHref('a'.repeat(maxMapsQueryLength + 1))).toBeNull();
  });
});
