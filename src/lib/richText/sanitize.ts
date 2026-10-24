import {
  HEADING_LEVELS,
  type BlockNode,
  type HeadingLevel,
  type InlineNode,
  type ListItemNode,
  type NestedBlockNode,
  type RichTextDoc,
  type RichTextMark,
} from './format';
import { safeLinkHref } from './href';

// Bounds recursion on hostile input. Real copy nests a list or two.
const MAX_DEPTH = 8;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childNodes(node: JsonObject): unknown[] {
  return Array.isArray(node.content) ? (node.content as unknown[]) : [];
}

function sanitizeMark(mark: JsonObject): RichTextMark | null {
  switch (mark.type) {
    case 'bold':
      return { type: 'bold' };
    case 'italic':
      return { type: 'italic' };
    case 'link': {
      const href = safeLinkHref(
        isObject(mark.attrs) ? mark.attrs.href : undefined,
      );
      return href === null ? null : { type: 'link', attrs: { href } };
    }
    default:
      return null;
  }
}

function sanitizeMarks(value: unknown): RichTextMark[] {
  if (!Array.isArray(value)) return [];
  const marks: RichTextMark[] = [];
  for (const candidate of value as unknown[]) {
    if (!isObject(candidate)) continue;
    const mark = sanitizeMark(candidate);
    if (mark && !marks.some((kept) => kept.type === mark.type)) {
      marks.push(mark);
    }
  }
  return marks;
}

function sanitizeInline(nodes: unknown[], depth: number): InlineNode[] {
  if (depth > MAX_DEPTH) return [];
  const inline: InlineNode[] = [];
  for (const node of nodes) {
    if (!isObject(node)) continue;
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || node.text === '') continue;
      const marks = sanitizeMarks(node.marks);
      inline.push(
        marks.length > 0
          ? { type: 'text', text: node.text, marks }
          : { type: 'text', text: node.text },
      );
    } else if (node.type === 'hardBreak') {
      inline.push({ type: 'hardBreak' });
    } else {
      // An unknown inline wrapper loses its tag and keeps its text.
      inline.push(...sanitizeInline(childNodes(node), depth + 1));
    }
  }
  return inline;
}

function headingLevel(attrs: unknown): HeadingLevel {
  const requested = isObject(attrs) ? attrs.level : undefined;
  const [lowest] = HEADING_LEVELS;
  if (typeof requested !== 'number' || !Number.isInteger(requested)) {
    return lowest;
  }
  const highest = HEADING_LEVELS[HEADING_LEVELS.length - 1] ?? lowest;
  const clamped = Math.min(Math.max(requested, lowest), highest);
  return HEADING_LEVELS.find((level) => level === clamped) ?? lowest;
}

function isNestedBlock(block: BlockNode): block is NestedBlockNode {
  return (
    block.type === 'paragraph' ||
    block.type === 'bulletList' ||
    block.type === 'orderedList'
  );
}

// Inside a list item or a quote, headings become paragraphs, quotes lose their
// wrapper, and rules are dropped.
function sanitizeNested(nodes: unknown[], depth: number): NestedBlockNode[] {
  return sanitizeBlocks(nodes, depth, false).filter(isNestedBlock);
}

function sanitizeList(
  type: 'bulletList' | 'orderedList',
  node: JsonObject,
  depth: number,
): BlockNode[] {
  const items: ListItemNode[] = [];
  for (const child of childNodes(node)) {
    if (!isObject(child)) continue;
    // A block placed straight in a list gets an item of its own.
    const content = sanitizeNested(
      child.type === 'listItem' ? childNodes(child) : [child],
      depth + 1,
    );
    if (content.length > 0) items.push({ type: 'listItem', content });
  }
  return items.length > 0 ? [{ type, content: items }] : [];
}

function sanitizeBlock(
  node: JsonObject,
  depth: number,
  topLevel: boolean,
): BlockNode[] {
  switch (node.type) {
    case 'paragraph': {
      const content = sanitizeInline(childNodes(node), depth + 1);
      return content.length > 0 ? [{ type: 'paragraph', content }] : [];
    }
    case 'heading': {
      const content = sanitizeInline(childNodes(node), depth + 1);
      if (content.length === 0) return [];
      return topLevel
        ? [
            {
              type: 'heading',
              attrs: { level: headingLevel(node.attrs) },
              content,
            },
          ]
        : [{ type: 'paragraph', content }];
    }
    case 'bulletList':
    case 'orderedList':
      return sanitizeList(node.type, node, depth);
    case 'blockquote': {
      if (!topLevel) return sanitizeBlocks(childNodes(node), depth + 1, false);
      const content = sanitizeNested(childNodes(node), depth + 1);
      return content.length > 0 ? [{ type: 'blockquote', content }] : [];
    }
    case 'horizontalRule':
      return topLevel ? [{ type: 'horizontalRule' }] : [];
    default:
      // An unknown block loses its tag and keeps what it holds.
      return sanitizeBlocks(childNodes(node), depth + 1, topLevel);
  }
}

function sanitizeBlocks(
  nodes: unknown[],
  depth: number,
  topLevel: boolean,
): BlockNode[] {
  if (depth > MAX_DEPTH) return [];
  const blocks: BlockNode[] = [];
  let looseInline: unknown[] = [];

  // Text with no block around it gets a paragraph.
  const flushLooseInline = () => {
    const content = sanitizeInline(looseInline, depth);
    looseInline = [];
    if (content.length > 0) blocks.push({ type: 'paragraph', content });
  };

  for (const node of nodes) {
    if (!isObject(node)) continue;
    if (node.type === 'text' || node.type === 'hardBreak') {
      looseInline.push(node);
    } else {
      flushLooseInline();
      blocks.push(...sanitizeBlock(node, depth, topLevel));
    }
  }
  flushLooseInline();
  return blocks;
}

/**
 * Narrows any value to the rich-text format. Never throws: input that is not a document
 * becomes an empty one, unknown nodes and marks are dropped (their text stays), headings
 * are clamped to the allowed levels, and a link survives only with a safe `href`. Run it
 * on every write and again before rendering, since a stored row can predate a rule.
 */
export function sanitizeRichText(input: unknown): RichTextDoc {
  if (!isObject(input) || input.type !== 'doc') {
    return { type: 'doc', content: [] };
  }
  return { type: 'doc', content: sanitizeBlocks(childNodes(input), 0, true) };
}
