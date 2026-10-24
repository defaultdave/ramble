import { describe, expect, it } from 'vitest';
import { richTextSchema } from './schema';

const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

function nested(levels: number) {
  let node: unknown = paragraph(text('Deep'));
  for (let i = 0; i < levels; i += 1) {
    node = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [node] }],
    };
  }
  return node;
}

function issuesFor(input: unknown) {
  const result = richTextSchema.safeParse(input);
  if (result.success) throw new Error('expected the schema to reject');
  return result.error.issues.map(({ message, path }) => ({ message, path }));
}

describe('richTextSchema accepts', () => {
  it('a document made of allowed nodes and marks, as written', () => {
    const input = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
      paragraph(
        text('Hi ', [{ type: 'bold' }]),
        text('there', [{ type: 'link', attrs: { href: '/help' } }]),
      ),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [paragraph(text('One'))] }],
      },
    );
    expect(richTextSchema.parse(input)).toEqual(input);
  });

  it('what an editor writes: blank paragraphs and attributes outside the format', () => {
    const result = richTextSchema.parse(
      doc(
        { type: 'paragraph' },
        {
          type: 'orderedList',
          attrs: { start: 1, type: null },
          content: [{ type: 'listItem', content: [paragraph(text('A'))] }],
        },
        paragraph(
          text('Link', [
            {
              type: 'link',
              attrs: {
                href: 'https://example.com',
                target: '_blank',
                rel: 'noopener',
                class: null,
              },
            },
            { type: 'link', attrs: { href: 'https://example.com' } },
          ]),
        ),
      ),
    );
    expect(result).toEqual(
      doc(
        {
          type: 'orderedList',
          content: [{ type: 'listItem', content: [paragraph(text('A'))] }],
        },
        paragraph(
          text('Link', [
            { type: 'link', attrs: { href: 'https://example.com' } },
          ]),
        ),
      ),
    );
  });

  it('an empty document', () => {
    expect(richTextSchema.parse(doc())).toEqual(doc());
  });
});

describe('richTextSchema rejects, and says where and why', () => {
  it.each([
    [
      'a value that is not a document',
      '<p>Hi</p>',
      [{ message: 'The root must be a node of type "doc"', path: [] }],
    ],
    [
      'a node that is not a doc at the root',
      paragraph(text('Hi')),
      [{ message: 'The root must be a node of type "doc"', path: [] }],
    ],
    [
      'an unknown node',
      doc(paragraph(text('Ok')), { type: 'image', attrs: { src: '/a.png' } }),
      [{ message: 'Unknown node "image"', path: ['content', 1] }],
    ],
    [
      'an unknown inline node',
      doc(paragraph({ type: 'mention', content: [text('@dave')] })),
      [
        {
          message: 'Unknown node "mention"',
          path: ['content', 0, 'content', 0],
        },
      ],
    ],
    [
      'an unknown mark',
      doc(paragraph(text('Hi', [{ type: 'strike' }]))),
      [
        {
          message: 'Unknown mark "strike"',
          path: ['content', 0, 'content', 0, 'marks', 0],
        },
      ],
    ],
    [
      'an unsafe link',
      doc(
        paragraph(
          text('Hi', [
            { type: 'link', attrs: { href: 'javascript:alert(1)' } },
          ]),
        ),
      ),
      [
        {
          message:
            'A link needs an http, https, mailto, or tel address, a path on this site, or an anchor',
          path: ['content', 0, 'content', 0, 'marks', 0, 'attrs', 'href'],
        },
      ],
    ],
    [
      'a heading level out of range',
      doc({ type: 'heading', attrs: { level: 1 }, content: [text('Big')] }),
      [
        {
          message: 'Heading level must be 2, 3, 4',
          path: ['content', 0, 'attrs', 'level'],
        },
      ],
    ],
    [
      'a heading with no level',
      doc({ type: 'heading', content: [text('Big')] }),
      [
        {
          message: 'Heading level must be 2, 3, 4',
          path: ['content', 0, 'attrs', 'level'],
        },
      ],
    ],
    [
      'text outside a paragraph',
      doc(text('Loose')),
      [{ message: 'Text must sit in a paragraph', path: ['content', 0] }],
    ],
    [
      'a heading inside a list item',
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [text('H')] },
            ],
          },
        ],
      }),
      [
        {
          message: 'Headings are not allowed inside lists or quotes',
          path: ['content', 0, 'content', 0, 'content', 0],
        },
      ],
    ],
    [
      'a node that is not an object',
      doc(null),
      [{ message: 'A node must be an object', path: ['content', 0] }],
    ],
    [
      'a text node with no text',
      doc(paragraph({ type: 'text' })),
      [
        {
          message: 'A text node needs a text string',
          path: ['content', 0, 'content', 0],
        },
      ],
    ],
    [
      'a list nested past the depth limit',
      doc(nested(30)),
      [{ message: 'Nested too deeply', path: expect.any(Array) as unknown }],
    ],
  ])('%s', (_label, input, expected) => {
    expect(issuesFor(input)).toEqual(expected);
  });

  it('reports every problem in one pass', () => {
    const issues = issuesFor(
      doc({ type: 'image' }, paragraph(text('Hi', [{ type: 'underline' }])), {
        type: 'heading',
        attrs: { level: 6 },
        content: [text('H')],
      }),
    );
    expect(issues.map(({ message }) => message)).toEqual([
      'Unknown node "image"',
      'Unknown mark "underline"',
      'Heading level must be 2, 3, 4',
    ]);
  });

  it('stops listing at twenty problems on a hostile document', () => {
    const issues = issuesFor(
      doc(...Array.from({ length: 5_000 }, () => ({ type: 'image' }))),
    );
    expect(issues).toHaveLength(20);
  });
});
