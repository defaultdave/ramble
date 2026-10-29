import type { RichTextDoc } from './format';

/** A document of plain paragraphs, one per text, so default copy and edited copy render the same way. */
export function paragraphs(...texts: string[]): RichTextDoc {
  return {
    type: 'doc',
    content: texts.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

export function hasContent(doc: RichTextDoc | null): doc is RichTextDoc {
  return doc !== null && doc.content.length > 0;
}
