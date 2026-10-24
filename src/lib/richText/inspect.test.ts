import { describe, expect, it } from 'vitest';
import { inspectRichText, sanitizeRichText } from './sanitize';

const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const docOf = (content: unknown[]) => ({ type: 'doc', content });
const many = <T>(count: number, make: () => T) =>
  Array.from({ length: count }, make);
const link = (href: string) => ({ type: 'link', attrs: { href } });

// Under the visit budget, so the whole document comes back.
const WIDE = 30_000;
// Over it, and over the roughly 130,000 arguments a spread can pass before the stack gives out.
const TOO_WIDE = 250_000;

function codes(input: unknown) {
  return inspectRichText(input).problems.map(({ code }) => code);
}

describe('sanitizeRichText on wide input', () => {
  it('keeps a long child list under an unknown block wrapper', () => {
    const result = sanitizeRichText(
      doc({
        type: 'callout',
        content: many(WIDE, () => paragraph(text('x'))),
      }),
    );
    expect(result.content).toHaveLength(WIDE);
  });

  it('keeps a long child list under an unknown inline wrapper', () => {
    const result = sanitizeRichText(
      doc(paragraph({ type: 'mention', content: many(WIDE, () => text('x')) })),
    );
    expect(result.content[0]).toHaveProperty('content.length', WIDE);
  });

  it('keeps many loose text nodes, list items, and marks', () => {
    expect(
      sanitizeRichText(docOf(many(WIDE, () => text('x')))).content,
    ).toHaveLength(1);

    const items = sanitizeRichText(
      doc({
        type: 'bulletList',
        content: many(WIDE, () => ({
          type: 'listItem',
          content: [paragraph(text('x'))],
        })),
      }),
    );
    expect(items.content[0]).toHaveProperty('content.length', WIDE);

    const marked = sanitizeRichText(
      doc(
        paragraph(
          text(
            'x',
            many(WIDE, () => ({ type: 'bold' })),
          ),
        ),
      ),
    );
    expect(marked.content[0]).toHaveProperty('content.0.marks.length', 1);
  });

  it.each([
    [
      'an unknown block wrapper',
      () =>
        doc({
          type: 'callout',
          content: many(TOO_WIDE, () => paragraph(text('x'))),
        }),
    ],
    [
      'an unknown inline wrapper',
      () =>
        doc(
          paragraph({
            type: 'mention',
            content: many(TOO_WIDE, () => text('x')),
          }),
        ),
    ],
    ['loose text', () => docOf(many(TOO_WIDE, () => text('x')))],
    [
      'a list',
      () =>
        doc({
          type: 'bulletList',
          content: many(TOO_WIDE, () => ({
            type: 'listItem',
            content: [paragraph(text('x'))],
          })),
        }),
    ],
    [
      'marks',
      () =>
        doc(
          paragraph(
            text(
              'x',
              many(TOO_WIDE, () => ({ type: 'bold' })),
            ),
          ),
        ),
    ],
  ])('stops reading %s past the budget and reports it', (_label, build) => {
    const { doc: repaired, problems } = inspectRichText(build());
    expect(problems.map(({ code }) => code)).toContain('too-large');
    expect(repaired.type).toBe('doc');
  });

  it('is not slowed by a node that appears in its own content many times', () => {
    // 50 references at each of 7 levels would be 50^7 visits without a budget.
    let shared: unknown = paragraph(text('x'));
    for (let level = 0; level < 7; level += 1) {
      shared = { type: 'callout', content: many(50, () => shared) };
    }
    const started = performance.now();
    const { problems } = inspectRichText(doc(shared));
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(problems.map(({ code }) => code)).toContain('too-large');
  });

  it('is not slowed by a node that contains itself', () => {
    const loop: { type: string; content: unknown[] } = {
      type: 'callout',
      content: [],
    };
    loop.content.push(loop, loop, loop);
    const { problems } = inspectRichText(doc(loop));
    expect(problems.map(({ code }) => code)).toContain('too-deep');
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
      doc(paragraph(text('a', [link('//example.com')]))),
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

  it('reports problems in document order and stops at twenty', () => {
    const { problems } = inspectRichText(
      docOf(
        Array.from({ length: 30 }, (_, index) => ({
          type: `n${String(index)}`,
        })),
      ),
    );
    expect(problems.map(({ message }) => message)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `Unknown node "n${String(index)}"`,
      ),
    );
  });
});

describe('content that is not a list', () => {
  it.each([
    [
      'a paragraph',
      doc({ type: 'paragraph', content: 'hello' }),
      ['content', 0, 'content'],
    ],
    ['a document', { type: 'doc', content: 'x' }, ['content']],
    [
      'a list',
      doc({ type: 'bulletList', content: { 0: 'x' } }),
      ['content', 0, 'content'],
    ],
    [
      'a list item',
      doc({
        type: 'bulletList',
        content: [{ type: 'listItem', content: 'x' }],
      }),
      ['content', 0, 'content', 0, 'content'],
    ],
    [
      'a quote',
      doc({ type: 'blockquote', content: 5 }),
      ['content', 0, 'content'],
    ],
  ])('flags the content of %s', (_label, input, path) => {
    expect(inspectRichText(input).problems).toEqual([
      expect.objectContaining({ code: 'malformed-node', path }),
    ]);
  });
});

describe('what an author could lose', () => {
  it('flags a second link with a different address, and not one with the same', () => {
    expect(codes(doc(paragraph(text('a', [link('/a'), link('/b')]))))).toEqual([
      'conflicting-mark',
    ]);
    expect(codes(doc(paragraph(text('a', [link('/a'), link('/a')]))))).toEqual(
      [],
    );
  });

  it.each([
    [4, { attrs: { start: 4 } }],
    [1, {}],
    [null, {}],
    [undefined, {}],
  ])('keeps a list start of %j as %j', (start, expected) => {
    const result = inspectRichText(
      doc({
        type: 'orderedList',
        attrs: { start, type: null },
        content: [{ type: 'listItem', content: [paragraph(text('a'))] }],
      }),
    );
    expect(result.problems).toEqual([]);
    expect(result.doc.content[0]).toMatchObject(expected);
    if (!('attrs' in expected)) {
      expect(result.doc.content[0]).not.toHaveProperty('attrs');
    }
  });

  it.each([0, -1, 2.5, '4', Infinity, 2 ** 60])(
    'flags an unusable list start of %j',
    (start) => {
      const { problems } = inspectRichText(
        doc({
          type: 'orderedList',
          attrs: { start },
          content: [{ type: 'listItem', content: [paragraph(text('a'))] }],
        }),
      );
      expect(problems).toEqual([
        expect.objectContaining({
          code: 'invalid-attribute',
          path: ['content', 0, 'attrs', 'start'],
        }),
      ]);
    },
  );

  it.each([
    [
      'textAlign other than left',
      { textAlign: 'center' },
      ['content', 0, 'attrs', 'textAlign'],
    ],
    ['a class', { class: 'x' }, ['content', 0, 'attrs', 'class']],
    ['a style', { style: 'color:red' }, ['content', 0, 'attrs', 'style']],
  ])('flags %s on a paragraph', (_label, attrs, path) => {
    expect(
      inspectRichText(doc({ type: 'paragraph', attrs, content: [text('a')] }))
        .problems,
    ).toEqual([
      expect.objectContaining({ code: 'attribute-not-allowed', path }),
    ]);
  });

  it('flags a key on a node that Tiptap JSON does not have', () => {
    expect(
      codes(
        doc({ type: 'paragraph', style: 'color:red', content: [text('a')] }),
      ),
    ).toEqual(['attribute-not-allowed']);
  });

  it('flags a link title, which the author wrote, but not its target or rel', () => {
    expect(
      codes(
        doc(
          paragraph(
            text('a', [
              {
                type: 'link',
                attrs: { href: '/a', target: '_blank', rel: 'x' },
              },
            ]),
          ),
        ),
      ),
    ).toEqual([]);
    expect(
      codes(
        doc(
          paragraph(
            text('a', [
              { type: 'link', attrs: { href: '/a', title: 'Hover' } },
            ]),
          ),
        ),
      ),
    ).toEqual(['attribute-not-allowed']);
  });

  it.each([
    ['a blank paragraph', doc({ type: 'paragraph' })],
    ['empty text', doc(paragraph(text('')))],
    [
      'a repeated mark',
      doc(paragraph(text('a', [{ type: 'bold' }, { type: 'bold' }]))),
    ],
    [
      'attributes at their default',
      doc({
        type: 'paragraph',
        attrs: { textAlign: 'left', class: null, id: null },
        content: [text('a')],
      }),
    ],
    ['an empty list', doc({ type: 'bulletList', content: [] })],
  ])('tidies %s without a problem', (_label, input) => {
    expect(inspectRichText(input).problems).toEqual([]);
  });
});
