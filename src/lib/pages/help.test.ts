import { describe, expect, it } from 'vitest';
import {
  buildHelpIndex,
  containsPattern,
  helpArticleHead,
  helpArticlePath,
  helpIndexHead,
  helpSearchMaxLength,
  parseHelpQuery,
} from './help';

// Behaviours under test:
// - a search term is trimmed, collapsed, length-bounded, and the first of a repeated q; blank is no search
// - the ILIKE pattern wraps the term and takes %, _ and \ literally
// - the index is all articles with no search, results with matches, and the no-results state with none
// - a searched index is kept out of search engines; an article's head names it, or says it is missing

const article = (slug: string) => ({
  id: slug,
  slug,
  title: slug,
  summary: null,
});

describe('parseHelpQuery', () => {
  it.each([
    ['nothing', undefined, null],
    ['an empty string', '', null],
    ['only spaces', '   \t ', null],
    ['a plain word', 'cancel', 'cancel'],
    [
      'padding and inner runs of space',
      '  where   to\n meet ',
      'where to meet',
    ],
    ['the first of a repeated q', ['weather', 'gift'], 'weather'],
    ['an empty list', [], null],
  ])('reads %s', (_name, raw, expected) => {
    expect(parseHelpQuery(raw)).toBe(expected);
  });

  it('cuts a long term at the cap without leaving a trailing space', () => {
    const long = `${'a'.repeat(helpSearchMaxLength - 1)} ${'b'.repeat(500)}`;
    const term = parseHelpQuery(long);
    expect(term).toBe('a'.repeat(helpSearchMaxLength - 1));
  });
});

describe('containsPattern', () => {
  it.each([
    ['a plain word', 'cancel', '%cancel%'],
    ['a percent sign', '100%', '%100\\%%'],
    ['an underscore', 'a_b', '%a\\_b%'],
    ['a backslash', 'a\\b', '%a\\\\b%'],
    ['every wildcard at once', '%_\\', '%\\%\\_\\\\%'],
  ])('escapes %s', (_name, term, pattern) => {
    expect(containsPattern(term)).toBe(pattern);
  });
});

describe('buildHelpIndex', () => {
  const articles = [article('a'), article('b')];

  it('lists every article when nothing was searched', () => {
    expect(buildHelpIndex(null, articles)).toEqual({
      kind: 'articles',
      articles,
    });
  });

  it('lists the matches of a search', () => {
    expect(buildHelpIndex('a', articles)).toEqual({
      kind: 'results',
      query: 'a',
      articles,
    });
  });

  it('is the no-results state when a search found nothing', () => {
    expect(buildHelpIndex('zzz', [])).toEqual({ kind: 'none', query: 'zzz' });
  });

  it('shows an index with no articles and no search as an empty list, not as a failed search', () => {
    expect(buildHelpIndex(null, [])).toEqual({
      kind: 'articles',
      articles: [],
    });
  });
});

describe('heads', () => {
  it('keeps a searched index out of search engines and the plain one in', () => {
    expect(helpIndexHead(null).robots).toBeUndefined();
    expect(helpIndexHead('cancel').robots).toEqual({
      index: false,
      follow: true,
    });
  });

  it.each([
    [
      'a summary',
      { title: 'T', summary: 'S' },
      { title: 'T', description: 'S' },
    ],
    ['no summary', { title: 'T', summary: null }, { title: 'T' }],
    ['no article', null, { title: 'Help article not found' }],
  ])('names an article with %s', (_name, input, head) => {
    expect(helpArticleHead(input)).toEqual(head);
  });

  it('addresses an article under the help center', () => {
    expect(helpArticlePath('how-to-cancel')).toBe('/help/how-to-cancel');
  });
});
