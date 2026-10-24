import { describe, expect, it } from 'vitest';
import { inspectRichText, sanitizeRichText } from './sanitize';

const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const many = <T>(count: number, make: () => T) =>
  Array.from({ length: count }, make);

// More than the roughly 130,000 arguments a spread can pass before the call stack gives out.
const BREADTH = 200_000;

describe('sanitizeRichText stays total on wide input', () => {
  it('handles an unknown block wrapper with a very long child list', () => {
    const result = sanitizeRichText(
      doc({
        type: 'callout',
        content: many(BREADTH, () => paragraph(text('x'))),
      }),
    );
    expect(result.content).toHaveLength(BREADTH);
  });

  it('handles an unknown inline wrapper with a very long child list', () => {
    const result = sanitizeRichText(
      doc(
        paragraph({ type: 'mention', content: many(BREADTH, () => text('x')) }),
      ),
    );
    expect(result.content[0]).toHaveProperty('content.length', BREADTH);
  });

  it('handles very many loose text nodes, list items, and marks', () => {
    const loose = sanitizeRichText({
      type: 'doc',
      content: many(BREADTH, () => text('x')),
    });
    expect(loose.content).toHaveLength(1);

    const items = sanitizeRichText(
      doc({
        type: 'bulletList',
        content: many(BREADTH, () => ({
          type: 'listItem',
          content: [paragraph(text('x'))],
        })),
      }),
    );
    expect(items.content[0]).toHaveProperty('content.length', BREADTH);

    const marked = sanitizeRichText(
      doc(
        paragraph(
          text(
            'x',
            many(BREADTH, () => ({ type: 'bold' })),
          ),
        ),
      ),
    );
    expect(marked.content[0]).toHaveProperty('content.0.marks.length', 1);
  });
});

describe('inspectRichText', () => {
  it('returns the same document as sanitizeRichText, with the problems', () => {
    const input = doc(
      { type: 'image' },
      paragraph(text('Hi', [{ type: 'strike' }])),
    );
    const { doc: repaired, problems } = inspectRichText(input);
    expect(repaired).toEqual(sanitizeRichText(input));
    expect(problems.map(({ code }) => code)).toEqual([
      'unknown-node',
      'unknown-mark',
    ]);
  });

  it.each([
    ['not-a-document', 'hello', []],
    ['unknown-node', doc({ type: 'image' }), ['content', 0]],
    [
      'unknown-mark',
      doc(paragraph(text('a', [{ type: 'code' }]))),
      ['content', 0, 'content', 0, 'marks', 0],
    ],
    [
      'unsafe-href',
      doc(
        paragraph(
          text('a', [{ type: 'link', attrs: { href: '//example.com' } }]),
        ),
      ),
      ['content', 0, 'content', 0, 'marks', 0, 'attrs', 'href'],
    ],
    [
      'heading-level',
      doc({ type: 'heading', attrs: { level: 5 }, content: [text('a')] }),
      ['content', 0, 'attrs', 'level'],
    ],
    ['misplaced-node', doc(text('loose')), ['content', 0]],
    ['malformed-node', doc(7), ['content', 0]],
  ])('flags %s at its path', (code, input, path) => {
    expect(inspectRichText(input).problems).toEqual([
      expect.objectContaining({ code, path }),
    ]);
  });

  it('flags a document nested past the depth limit, and its repair is empty', () => {
    let node: unknown = paragraph(text('Deep'));
    for (let i = 0; i < 30; i += 1) {
      node = {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [node] }],
      };
    }
    const { doc: repaired, problems } = inspectRichText(doc(node));
    expect(problems.map(({ code }) => code)).toContain('too-deep');
    expect(JSON.stringify(repaired)).not.toContain('Deep');
  });

  it.each([
    ['a blank paragraph', doc({ type: 'paragraph' })],
    ['empty text', doc(paragraph(text('')))],
    [
      'a repeated mark',
      doc(paragraph(text('a', [{ type: 'bold' }, { type: 'bold' }]))),
    ],
    [
      'attributes outside the format',
      doc({ type: 'paragraph', attrs: { class: 'x' }, content: [text('a')] }),
    ],
    ['an empty list', doc({ type: 'bulletList', content: [] })],
  ])(
    'does not flag %s, which loses nothing the author wrote',
    (_label, input) => {
      expect(inspectRichText(input).problems).toEqual([]);
    },
  );

  it('keeps at most twenty problems', () => {
    const { problems } = inspectRichText({
      type: 'doc',
      content: many(BREADTH, () => ({ type: 'image' })),
    });
    expect(problems).toHaveLength(20);
  });
});
