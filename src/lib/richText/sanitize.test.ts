import { describe, expect, it } from 'vitest';
import type { RichTextDoc } from './format';
import { sanitizeRichText } from './sanitize';

const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

const EMPTY: RichTextDoc = { type: 'doc', content: [] };

// One of every node and mark the format allows.
const FULL_DOC: RichTextDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Cancellations' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Plain, ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        { type: 'hardBreak' },
        {
          type: 'text',
          text: 'and a link',
          marks: [
            { type: 'link', attrs: { href: 'https://example.com/help' } },
            { type: 'bold' },
          ],
        },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
            {
              type: 'orderedList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Nested' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] },
      ],
    },
    { type: 'horizontalRule' },
  ],
};

describe('sanitizeRichText', () => {
  it('keeps a document made only of allowed nodes and marks as it is', () => {
    expect(sanitizeRichText(FULL_DOC)).toEqual(FULL_DOC);
  });

  it('does not change its input', () => {
    const input = structuredClone(
      doc(paragraph(text('Hi', [{ type: 'strike' }]))),
    );
    const before = structuredClone(input);
    sanitizeRichText(input);
    expect(input).toEqual(before);
  });

  it('gives the same result when run twice', () => {
    const messy = doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
      {
        type: 'callout',
        content: [paragraph(text('Inside', [{ type: 'x' }]))],
      },
      text('loose'),
      {
        type: 'bulletList',
        content: [{ type: 'paragraph', content: [text('a')] }],
      },
    );
    const once = sanitizeRichText(messy);
    expect(sanitizeRichText(once)).toEqual(once);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '<p>hi</p>'],
    ['a number', 7],
    ['an array', [{ type: 'doc' }]],
    ['a node that is not a doc', paragraph(text('Hi'))],
  ])('turns %s into an empty document', (_label, input) => {
    expect(sanitizeRichText(input)).toEqual(EMPTY);
  });

  it('treats a doc with no content as empty', () => {
    expect(sanitizeRichText({ type: 'doc' })).toEqual(EMPTY);
  });

  describe('unknown nodes and marks', () => {
    it.each([
      [
        'an image',
        { type: 'image', attrs: { src: 'https://example.com/a.png' } },
      ],
      ['a code block', { type: 'codeBlock', content: [] }],
      ['an embed', { type: 'iframe', attrs: { src: 'https://example.com' } }],
      [
        'a raw HTML node',
        { type: 'html', attrs: { html: '<script>x()</script>' } },
      ],
    ])('drops %s that holds no text', (_label, node) => {
      expect(sanitizeRichText(doc(node, paragraph(text('Kept'))))).toEqual(
        doc(paragraph(text('Kept'))),
      );
    });

    it('unwraps an unknown block and keeps what it holds', () => {
      const input = doc({
        type: 'callout',
        content: [paragraph(text('Inside'))],
      });
      expect(sanitizeRichText(input)).toEqual(doc(paragraph(text('Inside'))));
    });

    it('unwraps an unknown inline node and keeps its text', () => {
      const input = doc(
        paragraph({ type: 'mention', content: [text('@dave')] }, text(' hi')),
      );
      expect(sanitizeRichText(input)).toEqual(
        doc(paragraph(text('@dave'), text(' hi'))),
      );
    });

    it.each(['strike', 'underline', 'code', 'highlight', 'textStyle'])(
      'drops the %s mark and keeps the text',
      (type) => {
        const input = doc(paragraph(text('Hi', [{ type }])));
        expect(sanitizeRichText(input)).toEqual(doc(paragraph(text('Hi'))));
      },
    );

    it('strips attributes that are not part of the format', () => {
      const input = doc({
        type: 'paragraph',
        attrs: { class: 'x', style: 'color:red', onclick: 'x()' },
        content: [
          {
            type: 'text',
            text: 'Hi',
            style: 'color:red',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: '/help',
                  target: '_blank',
                  rel: 'opener',
                  class: 'x',
                  onclick: 'x()',
                },
              },
            ],
          },
        ],
      });
      expect(sanitizeRichText(input)).toEqual(
        doc(
          paragraph(text('Hi', [{ type: 'link', attrs: { href: '/help' } }])),
        ),
      );
    });

    it('keeps one of each mark when a node repeats them', () => {
      const input = doc(
        paragraph(
          text('Hi', [{ type: 'bold' }, { type: 'bold' }, { type: 'italic' }]),
        ),
      );
      expect(sanitizeRichText(input)).toEqual(
        doc(paragraph(text('Hi', [{ type: 'bold' }, { type: 'italic' }]))),
      );
    });

    it('drops values in a content list that are not nodes', () => {
      const input = doc(
        null,
        'text',
        4,
        [paragraph(text('No'))],
        paragraph(text('Yes')),
      );
      expect(sanitizeRichText(input)).toEqual(doc(paragraph(text('Yes'))));
    });
  });

  describe('links', () => {
    it.each([
      'javascript:alert(1)',
      'data:text/html,<script>x()</script>',
      '//example.com',
      'java\nscript:alert(1)',
    ])('removes the link from %s and keeps its text', (href) => {
      const input = doc(
        paragraph(
          text('Click', [{ type: 'link', attrs: { href } }, { type: 'bold' }]),
        ),
      );
      expect(sanitizeRichText(input)).toEqual(
        doc(paragraph(text('Click', [{ type: 'bold' }]))),
      );
    });

    it.each([
      ['no attrs', { type: 'link' }],
      ['a missing href', { type: 'link', attrs: {} }],
      ['a non-string href', { type: 'link', attrs: { href: 5 } }],
    ])('removes a link mark with %s', (_label, mark) => {
      expect(sanitizeRichText(doc(paragraph(text('Hi', [mark]))))).toEqual(
        doc(paragraph(text('Hi'))),
      );
    });
  });

  describe('headings', () => {
    it.each([
      [1, 2],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 4],
      [6, 4],
      [0, 2],
      [-3, 2],
      [3.5, 2],
      ['3', 2],
      [undefined, 2],
    ])('level %j becomes level %i', (level, expected) => {
      const input = doc({
        type: 'heading',
        attrs: { level },
        content: [text('Title')],
      });
      expect(sanitizeRichText(input)).toEqual(
        doc({
          type: 'heading',
          attrs: { level: expected },
          content: [text('Title')],
        }),
      );
    });

    it('turns a heading inside a list item into a paragraph', () => {
      const input = doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [text('Hi')] },
            ],
          },
        ],
      });
      expect(sanitizeRichText(input)).toEqual(
        doc({
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph(text('Hi'))] }],
        }),
      );
    });
  });

  describe('structure', () => {
    it('wraps text that sits directly in the document in a paragraph', () => {
      const input = doc(text('Loose '), text('text', [{ type: 'bold' }]), {
        type: 'horizontalRule',
      });
      expect(sanitizeRichText(input)).toEqual(
        doc(paragraph(text('Loose '), text('text', [{ type: 'bold' }])), {
          type: 'horizontalRule',
        }),
      );
    });

    it('gives a block placed straight in a list an item of its own', () => {
      const input = doc({
        type: 'orderedList',
        content: [paragraph(text('A'))],
      });
      expect(sanitizeRichText(input)).toEqual(
        doc({
          type: 'orderedList',
          content: [{ type: 'listItem', content: [paragraph(text('A'))] }],
        }),
      );
    });

    it('unwraps a quote inside a list item and drops a rule there', () => {
      const input = doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'blockquote', content: [paragraph(text('Q'))] },
              { type: 'horizontalRule' },
            ],
          },
        ],
      });
      expect(sanitizeRichText(input)).toEqual(
        doc({
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph(text('Q'))] }],
        }),
      );
    });

    it.each([
      ['an empty paragraph', paragraph()],
      ['a paragraph of empty text', paragraph(text(''))],
      [
        'an empty heading',
        { type: 'heading', attrs: { level: 2 }, content: [] },
      ],
      ['an empty list', { type: 'bulletList', content: [] }],
      [
        'a list of empty items',
        { type: 'bulletList', content: [{ type: 'listItem', content: [] }] },
      ],
      ['an empty quote', { type: 'blockquote', content: [] }],
    ])('drops %s', (_label, node) => {
      expect(sanitizeRichText(doc(node))).toEqual(EMPTY);
    });

    it('does not follow a nesting depth that only an attack would use', () => {
      let node: unknown = paragraph(text('Deep'));
      for (let i = 0; i < 20_000; i += 1) {
        node = {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [node] }],
        };
      }
      const result = sanitizeRichText(doc(node));
      expect(JSON.stringify(result)).not.toContain('Deep');
    });

    it('keeps a list nested a few levels deep', () => {
      let node: unknown = paragraph(text('Deep'));
      for (let i = 0; i < 3; i += 1) {
        node = {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [node] }],
        };
      }
      expect(JSON.stringify(sanitizeRichText(doc(node)))).toContain('Deep');
    });
  });
});
