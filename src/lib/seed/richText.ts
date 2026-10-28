import type { BlockNode, RichTextDoc } from '@/lib/richText/format';

/** A document of plain paragraphs, for fixtures. */
export function paragraphs(...texts: string[]): RichTextDoc {
  return {
    type: 'doc',
    content: texts.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

type Block = string | { heading: string };

/** A document of paragraphs and level 2 headings. A string is a paragraph. */
export function blocks(...parts: Block[]): RichTextDoc {
  const content: BlockNode[] = parts.map((part) =>
    typeof part === 'string'
      ? { type: 'paragraph', content: [{ type: 'text', text: part }] }
      : {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: part.heading }],
        },
  );
  return { type: 'doc', content };
}

/** The text of a document, for the checks that read copy (tone, length). */
export function textOf(doc: RichTextDoc): string {
  const parts: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    const { text, content } = node as { text?: unknown; content?: unknown };
    if (typeof text === 'string') parts.push(text);
    if (Array.isArray(content)) for (const child of content) visit(child);
  };
  visit(doc);
  return parts.join(' ');
}
