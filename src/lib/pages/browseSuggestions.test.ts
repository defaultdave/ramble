import { describe, expect, it } from 'vitest';
import type { ZeroResultSuggestion } from '../zeroResults';
import { withSuggestions, type BrowseView } from './browse';

// Behaviours under test, one per decision, branch or risk:
// - an empty view takes the suggestions as given
// - an empty view on a chosen day does not take the date back off a second time, since "Any day" already is that
// - nothing left to offer leaves the view as it was, with no empty list on it
// - a view that is not empty comes back untouched

const suggestion = (
  param: ZeroResultSuggestion['param'],
): ZeroResultSuggestion => ({
  param,
  label: param,
  count: 3,
  href: `/new-york/browse?without=${param}`,
});

const empty: BrowseView = { state: 'empty', filtered: true, dated: null };
const dated: BrowseView = {
  state: 'empty',
  filtered: true,
  dated: {
    dateLabel: 'Sat, Nov 7',
    nextDay: null,
    anyDayHref: '/new-york/browse',
    message: 'There are no experiences on later days.',
  },
};

describe('withSuggestions', () => {
  it('puts the suggestions on an empty view', () => {
    const offered = [suggestion('categories'), suggestion('date')];

    expect(withSuggestions(empty, offered)).toEqual({
      ...empty,
      suggestions: offered,
    });
  });

  it('leaves the date off when the view already has a way out of the day', () => {
    expect(
      withSuggestions(dated, [suggestion('date'), suggestion('price')]),
    ).toEqual({ ...dated, suggestions: [suggestion('price')] });
  });

  it.each([
    ['no suggestions', empty, []],
    ['only the date, on a chosen day', dated, [suggestion('date')]],
  ])('is the view as it was with %s', (_, view, offered) => {
    expect(withSuggestions(view, offered)).toBe(view);
  });

  it('does not touch a view that is not empty', () => {
    const outdated: BrowseView = { state: 'outdated', startHref: '/x' };

    expect(withSuggestions(outdated, [suggestion('price')])).toBe(outdated);
  });
});
