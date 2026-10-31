import { describe, expect, it } from 'vitest';
import { parseFilters } from '../filters';
import { searchHref, siteChrome } from './siteNav';

// Behaviours under test, one per decision, branch or risk:
// - the header pill names the party its link applies, and no day it cannot know
// - the pill links to browse with that party, which browse reads back

describe('the header search', () => {
  it('says anywhere, any day, and two guests', () => {
    expect(siteChrome.searchLabel).toBe('Anywhere · Any day · 2 guests');
  });

  it('links to browse with two guests, and browse reads two guests from it', () => {
    expect(searchHref).toBe('/new-york/browse?guests=2');
    const [, query = ''] = searchHref.split('?');
    const params = Object.fromEntries(new URLSearchParams(query));
    expect(parseFilters(params).filters.guests).toBe(2);
  });
});
