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

/** A document with nothing in it: where a new body starts. */
export const emptyDoc: RichTextDoc = { type: 'doc', content: [] };

/** What the editor starts from: the document, or an empty string when it has nothing in it. */
export function editorStartContent(doc: RichTextDoc): RichTextDoc | '' {
  return hasContent(doc) ? doc : '';
}

/** The document, or none when it is edited down to nothing: a stored document is never an empty one. */
export function docOrNull(doc: RichTextDoc | null): RichTextDoc | null {
  return hasContent(doc) ? doc : null;
}
