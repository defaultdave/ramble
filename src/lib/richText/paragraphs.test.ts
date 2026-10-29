import { describe, expect, it } from 'vitest';
import { hasContent, paragraphs } from './paragraphs';

// Behaviours under test, one per decision, branch or risk:
// - one text is one paragraph, the exact document a single sentence of copy has always been
// - several texts are several paragraphs in order, and no text is an empty document
// - a document has content when it is not null and has at least one block

describe('paragraphs', () => {
  it('writes one text as one paragraph', () => {
    expect(paragraphs('Pasta, mostly.')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Pasta, mostly.' }],
        },
      ],
    });
  });

  it('writes several texts as paragraphs in order', () => {
    expect(paragraphs('One.', 'Two.').content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'One.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Two.' }] },
    ]);
  });

  it('writes no text as an empty document', () => {
    expect(paragraphs()).toEqual({ type: 'doc', content: [] });
  });
});

describe('hasContent', () => {
  it.each([
    ['null', null, false],
    ['an empty document', paragraphs(), false],
    ['a paragraph', paragraphs('x'), true],
  ])('%s', (_name, doc, expected) => {
    expect(hasContent(doc)).toBe(expected);
  });
});
