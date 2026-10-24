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

// A document built to be rejected can have a problem per node. Twenty is enough to fix.
const MAX_PROBLEMS = 20;

type RichTextProblemCode =
  | 'not-a-document'
  | 'malformed-node'
  | 'unknown-node'
  | 'unknown-mark'
  | 'misplaced-node'
  | 'heading-level'
  | 'unsafe-href'
  | 'too-deep';

export type RichTextProblem = {
  code: RichTextProblemCode;
  /** Where in the input, as keys and indexes from the document root. */
  path: (string | number)[];
  message: string;
};

type Path = readonly (string | number)[];
type JsonObject = Record<string, unknown>;
type Report = RichTextProblem[];

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childNodes(node: JsonObject): unknown[] {
  return Array.isArray(node.content) ? (node.content as unknown[]) : [];
}

function childPath(parent: Path, index: number): Path {
  return [...parent, 'content', index];
}

function note(
  report: Report,
  path: Path,
  code: RichTextProblemCode,
  message: string,
) {
  if (report.length < MAX_PROBLEMS)
    report.push({ code, path: [...path], message });
}

function describeType(value: unknown): string {
  if (typeof value !== 'string') return 'with no type';
  return `"${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;
}

function sanitizeMark(
  mark: JsonObject,
  path: Path,
  report: Report,
): RichTextMark | null {
  switch (mark.type) {
    case 'bold':
      return { type: 'bold' };
    case 'italic':
      return { type: 'italic' };
    case 'link': {
      const href = safeLinkHref(
        isObject(mark.attrs) ? mark.attrs.href : undefined,
      );
      if (href === null) {
        note(
          report,
          [...path, 'attrs', 'href'],
          'unsafe-href',
          'A link needs an http, https, mailto, or tel address, a path on this site, or an anchor',
        );
        return null;
      }
      return { type: 'link', attrs: { href } };
    }
    default:
      note(
        report,
        path,
        'unknown-mark',
        `Unknown mark ${describeType(mark.type)}`,
      );
      return null;
  }
}

function sanitizeMarks(
  value: unknown,
  nodePath: Path,
  report: Report,
): RichTextMark[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    note(
      report,
      [...nodePath, 'marks'],
      'malformed-node',
      'Marks must be a list',
    );
    return [];
  }
  const marks: RichTextMark[] = [];
  const candidates = value as unknown[];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const path = [...nodePath, 'marks', index];
    if (!isObject(candidate)) {
      note(report, path, 'malformed-node', 'A mark must be an object');
      continue;
    }
    const mark = sanitizeMark(candidate, path, report);
    // Repeating a mark changes nothing, so it is not a problem.
    if (mark && !marks.some((kept) => kept.type === mark.type)) {
      marks.push(mark);
    }
  }
  return marks;
}

function sanitizeInlineNode(
  node: unknown,
  path: Path,
  depth: number,
  report: Report,
  out: InlineNode[],
) {
  if (depth > MAX_DEPTH) {
    note(report, path, 'too-deep', 'Nested too deeply');
    return;
  }
  if (!isObject(node)) {
    note(report, path, 'malformed-node', 'A node must be an object');
    return;
  }
  if (node.type === 'text') {
    if (typeof node.text !== 'string') {
      note(report, path, 'malformed-node', 'A text node needs a text string');
      return;
    }
    // Editors leave empty text behind; there is nothing in it to lose.
    if (node.text === '') return;
    const marks = sanitizeMarks(node.marks, path, report);
    out.push(
      marks.length > 0
        ? { type: 'text', text: node.text, marks }
        : { type: 'text', text: node.text },
    );
    return;
  }
  if (node.type === 'hardBreak') {
    out.push({ type: 'hardBreak' });
    return;
  }
  // An unknown inline node loses its tag and keeps its text.
  note(report, path, 'unknown-node', `Unknown node ${describeType(node.type)}`);
  inlineChildren(node, path, depth + 1, report, out);
}

// Loops, not spreads: a spread of a long child list overflows the call stack.
function inlineChildren(
  node: JsonObject,
  path: Path,
  depth: number,
  report: Report,
  out: InlineNode[],
) {
  const children = childNodes(node);
  for (let index = 0; index < children.length; index += 1) {
    sanitizeInlineNode(
      children[index],
      childPath(path, index),
      depth,
      report,
      out,
    );
  }
}

function headingLevel(attrs: unknown): HeadingLevel | null {
  const requested = isObject(attrs) ? attrs.level : undefined;
  return HEADING_LEVELS.find((level) => level === requested) ?? null;
}

// The nearest allowed level, for the repair.
function clampedHeadingLevel(attrs: unknown): HeadingLevel {
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
function sanitizeNested(
  nodes: readonly unknown[],
  pathOf: (index: number) => Path,
  parentPath: Path,
  depth: number,
  report: Report,
): NestedBlockNode[] {
  const blocks: BlockNode[] = [];
  sanitizeBlocks(nodes, pathOf, parentPath, depth, false, report, blocks);
  return blocks.filter(isNestedBlock);
}

function sanitizeList(
  type: 'bulletList' | 'orderedList',
  node: JsonObject,
  path: Path,
  depth: number,
  report: Report,
  out: BlockNode[],
) {
  const items: ListItemNode[] = [];
  const children = childNodes(node);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!isObject(child)) {
      note(
        report,
        childPath(path, index),
        'malformed-node',
        'A node must be an object',
      );
      continue;
    }
    const itemPath = childPath(path, index);
    let content: NestedBlockNode[];
    if (child.type === 'listItem') {
      const grandchildren = childNodes(child);
      content = sanitizeNested(
        grandchildren,
        (at) => childPath(itemPath, at),
        itemPath,
        depth + 1,
        report,
      );
    } else {
      note(report, itemPath, 'misplaced-node', 'A list holds list items');
      // A block placed straight in a list gets an item of its own.
      content = sanitizeNested(
        [child],
        () => itemPath,
        itemPath,
        depth + 1,
        report,
      );
    }
    if (content.length > 0) items.push({ type: 'listItem', content });
  }
  if (items.length > 0) out.push({ type, content: items });
}

function sanitizeBlockNode(
  node: JsonObject,
  path: Path,
  depth: number,
  topLevel: boolean,
  report: Report,
  out: BlockNode[],
) {
  switch (node.type) {
    case 'paragraph': {
      const content: InlineNode[] = [];
      inlineChildren(node, path, depth + 1, report, content);
      if (content.length > 0) out.push({ type: 'paragraph', content });
      return;
    }
    case 'heading': {
      const content: InlineNode[] = [];
      inlineChildren(node, path, depth + 1, report, content);
      if (!topLevel) {
        note(
          report,
          path,
          'misplaced-node',
          'Headings are not allowed inside lists or quotes',
        );
        if (content.length > 0) out.push({ type: 'paragraph', content });
        return;
      }
      if (headingLevel(node.attrs) === null) {
        note(
          report,
          [...path, 'attrs', 'level'],
          'heading-level',
          `Heading level must be ${HEADING_LEVELS.join(', ')}`,
        );
      }
      if (content.length > 0) {
        out.push({
          type: 'heading',
          attrs: { level: clampedHeadingLevel(node.attrs) },
          content,
        });
      }
      return;
    }
    case 'bulletList':
    case 'orderedList':
      sanitizeList(node.type, node, path, depth, report, out);
      return;
    case 'blockquote': {
      if (!topLevel) {
        note(
          report,
          path,
          'misplaced-node',
          'Quotes are not allowed inside lists or quotes',
        );
        sanitizeBlocks(
          childNodes(node),
          (index) => childPath(path, index),
          path,
          depth + 1,
          false,
          report,
          out,
        );
        return;
      }
      const content = sanitizeNested(
        childNodes(node),
        (index) => childPath(path, index),
        path,
        depth + 1,
        report,
      );
      if (content.length > 0) out.push({ type: 'blockquote', content });
      return;
    }
    case 'horizontalRule':
      if (topLevel) {
        out.push({ type: 'horizontalRule' });
      } else {
        note(
          report,
          path,
          'misplaced-node',
          'Rules are not allowed inside lists or quotes',
        );
      }
      return;
    case 'listItem':
      note(report, path, 'misplaced-node', 'A list item belongs in a list');
      sanitizeBlocks(
        childNodes(node),
        (index) => childPath(path, index),
        path,
        depth + 1,
        topLevel,
        report,
        out,
      );
      return;
    default:
      // An unknown block loses its tag and keeps what it holds.
      note(
        report,
        path,
        'unknown-node',
        `Unknown node ${describeType(node.type)}`,
      );
      sanitizeBlocks(
        childNodes(node),
        (index) => childPath(path, index),
        path,
        depth + 1,
        topLevel,
        report,
        out,
      );
  }
}

function sanitizeBlocks(
  nodes: readonly unknown[],
  pathOf: (index: number) => Path,
  parentPath: Path,
  depth: number,
  topLevel: boolean,
  report: Report,
  out: BlockNode[],
) {
  if (depth > MAX_DEPTH) {
    note(report, parentPath, 'too-deep', 'Nested too deeply');
    return;
  }

  let looseInline: { node: unknown; path: Path }[] = [];

  // Text with no block around it gets a paragraph.
  const flushLooseInline = () => {
    const first = looseInline[0];
    if (!first) return;
    note(report, first.path, 'misplaced-node', 'Text must sit in a paragraph');
    const content: InlineNode[] = [];
    for (const { node, path } of looseInline) {
      sanitizeInlineNode(node, path, depth, report, content);
    }
    looseInline = [];
    if (content.length > 0) out.push({ type: 'paragraph', content });
  };

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const path = pathOf(index);
    if (!isObject(node)) {
      note(report, path, 'malformed-node', 'A node must be an object');
    } else if (node.type === 'text' || node.type === 'hardBreak') {
      looseInline.push({ node, path });
    } else {
      flushLooseInline();
      sanitizeBlockNode(node, path, depth, topLevel, report, out);
    }
  }
  flushLooseInline();
}

/**
 * Narrows any value to the rich-text format and reports what it had to change. Never
 * throws. Unknown nodes and marks are dropped (their text stays), headings are clamped to
 * the allowed levels, misplaced nodes are moved into a paragraph or item, and a link
 * survives only with a safe `href`. Input that is not a document becomes an empty one.
 *
 * Each repair that loses or moves content is a problem. Empty paragraphs and text,
 * repeated marks, and attributes outside the format are tidied without one, because
 * editors produce them and nothing the author wrote is lost.
 */
export function inspectRichText(input: unknown): {
  doc: RichTextDoc;
  problems: RichTextProblem[];
} {
  const problems: Report = [];
  if (!isObject(input) || input.type !== 'doc') {
    note(
      problems,
      [],
      'not-a-document',
      'The root must be a node of type "doc"',
    );
    return { doc: { type: 'doc', content: [] }, problems };
  }
  const content: BlockNode[] = [];
  sanitizeBlocks(
    childNodes(input),
    (index) => childPath([], index),
    [],
    0,
    true,
    problems,
    content,
  );
  return { doc: { type: 'doc', content }, problems };
}

/**
 * The total repair, for the render path: whatever comes in, a valid document comes out.
 * The write path uses `richTextSchema`, which refuses what this would repair.
 */
export function sanitizeRichText(input: unknown): RichTextDoc {
  return inspectRichText(input).doc;
}
