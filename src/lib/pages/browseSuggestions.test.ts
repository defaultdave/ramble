import { describe, expect, it } from 'vitest';
import type { ZeroResultSuggestion } from '../zeroResults';
import { withSuggestions, type BrowseView } from './browse';

// Behaviours under test, one per decision, branch or risk:
// - an empty view takes the suggestions as given
// - nothing to offer leaves the view as it was, with no empty list on it
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

describe('withSuggestions', () => {
  it('puts the suggestions on an empty view', () => {
    const offered = [suggestion('categories'), suggestion('date')];

    expect(withSuggestions(empty, offered)).toEqual({
      ...empty,
      suggestions: offered,
    });
  });

  it('is the view as it was with no suggestions', () => {
    expect(withSuggestions(empty, [])).toBe(empty);
  });

  it('does not touch a view that is not empty', () => {
    const outdated: BrowseView = { state: 'outdated', startHref: '/x' };

    expect(withSuggestions(outdated, [suggestion('price')])).toBe(outdated);
  });
});
