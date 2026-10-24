// The rich-text document is Tiptap's JSON, narrowed to the nodes and marks below.
// Editorial copy, help articles, and legal documents are stored in this shape.
// `sanitizeRichText` drops anything outside it, so the editor and the renderer can
// both trust these types.

// The page supplies the h1, so body copy starts at h2.
export const HEADING_LEVELS = [2, 3, 4] as const;

export type HeadingLevel = (typeof HEADING_LEVELS)[number];

type BoldMark = { type: 'bold' };
type ItalicMark = { type: 'italic' };
type LinkMark = { type: 'link'; attrs: { href: string } };

export type RichTextMark = BoldMark | ItalicMark | LinkMark;

type TextNode = {
  type: 'text';
  text: string;
  marks?: RichTextMark[];
};

type HardBreakNode = { type: 'hardBreak' };

export type InlineNode = TextNode | HardBreakNode;

type ParagraphNode = { type: 'paragraph'; content?: InlineNode[] };

type HeadingNode = {
  type: 'heading';
  attrs: { level: HeadingLevel };
  content?: InlineNode[];
};

export type ListItemNode = {
  type: 'listItem';
  content: NestedBlockNode[];
};

type BulletListNode = { type: 'bulletList'; content: ListItemNode[] };

type OrderedListNode = {
  type: 'orderedList';
  // Present only when the list does not start at 1.
  attrs?: { start: number };
  content: ListItemNode[];
};

// What a list item or a blockquote may hold.
export type NestedBlockNode = ParagraphNode | BulletListNode | OrderedListNode;

type BlockquoteNode = {
  type: 'blockquote';
  content: NestedBlockNode[];
};

type HorizontalRuleNode = { type: 'horizontalRule' };

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode
  | HorizontalRuleNode;

export type RichTextDoc = { type: 'doc'; content: BlockNode[] };

export type RichTextNode = RichTextDoc | BlockNode | ListItemNode | InlineNode;
