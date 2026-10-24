import { describe, expect, it } from 'vitest';
import { richTextSchema } from './schema';

describe('richTextSchema', () => {
  it('sanitizes a document root', () => {
    const result = richTextSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Hi',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    });
    expect(result).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
    });
  });

  it.each([
    ['null', null],
    ['a string', '<p>Hi</p>'],
    ['a paragraph node', { type: 'paragraph' }],
    ['an object with no type', {}],
  ])('rejects %s', (_label, input) => {
    expect(richTextSchema.safeParse(input).success).toBe(false);
  });
});
