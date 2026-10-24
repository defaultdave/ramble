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

// Bounds work. A node object that appears in its own content several times (a shared
// reference, which JSON cannot hold but a Server Action argument can) multiplies the
// walk at every level. Real copy is a few hundred nodes.
const MAX_VISITS = 100_000;

// A document built to be rejected can have a problem per node. Twenty is enough to fix.
const MAX_PROBLEMS = 20;

type RichTextProblemCode =
  | 'not-a-document'
  | 'malformed-node'
  | 'unknown-node'
  | 'unknown-mark'
  | 'attribute-not-allowed'
  | 'invalid-attribute'
  | 'conflicting-mark'
  | 'misplaced-node'
  | 'heading-level'
  | 'unsafe-href'
  | 'too-deep'
  | 'too-large';

export type RichTextProblem = {
  code: RichTextProblemCode;
  /** Where in the input, as keys and indexes from the document root. */
  path: (string | number)[];
  message: string;
};

type Path = readonly (string | number)[];
type JsonObject = Record<string, unknown>;
type Report = { problems: RichTextProblem[]; visits: number };

// The keys of a Tiptap JSON node and mark.
const NODE_KEYS: ReadonlySet<string> = new Set([
  'type',
  'attrs',
  'content',
  'marks',
  'text',
]);

// Attributes each node or mark may carry. `target` and `rel` on a link are accepted and
// ignored: the renderer sets `rel` itself and never opens a new tab, so the values an
// editor writes there change nothing the reader sees.
const ALLOWED_ATTRIBUTES: ReadonlyMap<string, readonly string[]> = new Map([
  ['heading', ['level']],
  ['orderedList', ['start']],
  ['link', ['href', 'target', 'rel']],
]);

// What an editor writes for an attribute left at its default.
function isDefaultAttribute(name: string, value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (name === 'textAlign' && value === 'left')
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (report.problems.length < MAX_PROBLEMS) {
    report.problems.push({ code, path: [...path], message });
  }
}

// Counts a node and says whether the walk may go on. Once the budget is spent it stays
// spent, so every caller unwinds.
function canVisit(report: Report, path: Path): boolean {
  if (report.visits > MAX_VISITS) return false;
  report.visits += 1;
  if (report.visits > MAX_VISITS) {
    // Always recorded, even past the cap: it is the one problem that cuts the result short.
    report.problems.push({
      code: 'too-large',
      path: [...path],
      message: 'The document is too large',
    });
    return false;
  }
  return true;
}

function describeType(value: unknown): string {
  if (typeof value !== 'string') return 'with no type';
  return `"${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;
}

function childNodes(
  node: JsonObject,
  path: Path,
  report: Report,
): readonly unknown[] {
  if (node.content === undefined) return [];
  if (!Array.isArray(node.content)) {
    note(
      report,
      [...path, 'content'],
      'malformed-node',
      'Content must be a list',
    );
    return [];
  }
  return node.content as unknown[];
}

function checkAttributes(
  node: JsonObject,
  kind: string,
  path: Path,
  report: Report,
) {
  for (const key of Object.keys(node)) {
    if (!NODE_KEYS.has(key)) {
      note(
        report,
        [...path, key],
        'attribute-not-allowed',
        `"${key}" is not part of the format`,
      );
    }
  }
  if (node.attrs === undefined || node.attrs === null) return;
  if (!isObject(node.attrs)) {
    note(
      report,
      [...path, 'attrs'],
      'malformed-node',
      'Attributes must be an object',
    );
    return;
  }
  const allowed = ALLOWED_ATTRIBUTES.get(kind) ?? [];
  for (const [name, value] of Object.entries(node.attrs)) {
    if (allowed.includes(name) || isDefaultAttribute(name, value)) continue;
    note(
      report,
      [...path, 'attrs', name],
      'attribute-not-allowed',
      `The attribute "${name}" is not part of the format`,
    );
  }
}

function sanitizeMark(
  mark: JsonObject,
  path: Path,
  report: Report,
): RichTextMark | null {
  switch (mark.type) {
    case 'bold':
    case 'italic':
      checkAttributes(mark, mark.type, path, report);
      return { type: mark.type };
    case 'link': {
      checkAttributes(mark, 'link', path, report);
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
    const path = [...nodePath, 'marks', index];
    if (!canVisit(report, path)) break;
    const candidate = candidates[index];
    if (!isObject(candidate)) {
      note(report, path, 'malformed-node', 'A mark must be an object');
      continue;
    }
    const mark = sanitizeMark(candidate, path, report);
    if (!mark) continue;
    const kept = marks.find((existing) => existing.type === mark.type);
    if (!kept) {
      marks.push(mark);
    } else if (
      kept.type === 'link' &&
      mark.type === 'link' &&
      kept.attrs.href !== mark.attrs.href
    ) {
      // Repeating a mark changes nothing, but a second address would be lost.
      note(report, path, 'conflicting-mark', 'A text can carry only one link');
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
  if (!canVisit(report, path)) return;
  if (depth > MAX_DEPTH) {
    note(report, path, 'too-deep', 'Nested too deeply');
    return;
  }
  if (!isObject(node)) {
    note(report, path, 'malformed-node', 'A node must be an object');
    return;
  }
  if (node.type === 'text') {
    checkAttributes(node, 'text', path, report);
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
    checkAttributes(node, 'hardBreak', path, report);
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
  const children = childNodes(node, path, report);
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

// The number a list starts counting from, when it is not the default of 1.
function listStart(
  node: JsonObject,
  path: Path,
  report: Report,
): number | null {
  const start = isObject(node.attrs) ? node.attrs.start : undefined;
  if (start === undefined || start === null || start === 1) return null;
  if (typeof start === 'number' && Number.isSafeInteger(start) && start > 1) {
    return start;
  }
  note(
    report,
    [...path, 'attrs', 'start'],
    'invalid-attribute',
    'A list must start at a positive whole number',
  );
  return null;
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
  const start = type === 'orderedList' ? listStart(node, path, report) : null;
  const items: ListItemNode[] = [];
  const children = childNodes(node, path, report);
  for (let index = 0; index < children.length; index += 1) {
    const itemPath = childPath(path, index);
    if (!canVisit(report, itemPath)) break;
    const child = children[index];
    if (!isObject(child)) {
      note(report, itemPath, 'malformed-node', 'A node must be an object');
      continue;
    }
    let content: NestedBlockNode[];
    if (child.type === 'listItem') {
      checkAttributes(child, 'listItem', itemPath, report);
      content = sanitizeNested(
        childNodes(child, itemPath, report),
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
  if (items.length === 0) return;
  if (type === 'bulletList') {
    out.push({ type, content: items });
  } else {
    out.push(
      start === null
        ? { type, content: items }
        : { type, attrs: { start }, content: items },
    );
  }
}

function sanitizeBlockNode(
  node: JsonObject,
  path: Path,
  depth: number,
  topLevel: boolean,
  report: Report,
  out: BlockNode[],
) {
  const unwrap = (childrenTopLevel: boolean) => {
    sanitizeBlocks(
      childNodes(node, path, report),
      (index) => childPath(path, index),
      path,
      depth + 1,
      childrenTopLevel,
      report,
      out,
    );
  };

  switch (node.type) {
    case 'paragraph': {
      checkAttributes(node, 'paragraph', path, report);
      const content: InlineNode[] = [];
      inlineChildren(node, path, depth + 1, report, content);
      if (content.length > 0) out.push({ type: 'paragraph', content });
      return;
    }
    case 'heading': {
      checkAttributes(node, 'heading', path, report);
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
      checkAttributes(node, node.type, path, report);
      sanitizeList(node.type, node, path, depth, report, out);
      return;
    case 'blockquote': {
      checkAttributes(node, 'blockquote', path, report);
      if (!topLevel) {
        note(
          report,
          path,
          'misplaced-node',
          'Quotes are not allowed inside lists or quotes',
        );
        unwrap(false);
        return;
      }
      const content = sanitizeNested(
        childNodes(node, path, report),
        (index) => childPath(path, index),
        path,
        depth + 1,
        report,
      );
      if (content.length > 0) out.push({ type: 'blockquote', content });
      return;
    }
    case 'horizontalRule':
      checkAttributes(node, 'horizontalRule', path, report);
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
      unwrap(topLevel);
      return;
    default:
      // An unknown block loses its tag and keeps what it holds.
      note(
        report,
        path,
        'unknown-node',
        `Unknown node ${describeType(node.type)}`,
      );
      unwrap(topLevel);
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
    if (!canVisit(report, path)) break;
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

// TODO(U-076a): first caller, through `richTextSchema` in the editor's save action.
/**
 * Narrows any value to the rich-text format and reports what it had to change. Never
 * throws. Unknown nodes and marks are dropped (their text stays), headings are clamped to
 * the allowed levels, misplaced nodes are moved into a paragraph or item, and a link
 * survives only with a safe `href`. Input that is not a document becomes an empty one.
 *
 * Each repair that loses or moves what the author wrote is a problem. Four tidyings are
 * not, because an editor produces them and they lose nothing: empty paragraphs and empty
 * text; a mark repeated with the same address; attributes left at their default (null,
 * `textAlign: 'left'`, a list `start` of 1); and a link's `target` and `rel`, which the
 * renderer decides itself.
 *
 * Work is bounded by a visit budget, so a document with shared nodes cannot stall it.
 * Past the budget the walk stops with a `too-large` problem and the result holds what was
 * read so far.
 */
export function inspectRichText(input: unknown): {
  doc: RichTextDoc;
  problems: RichTextProblem[];
} {
  const report: Report = { problems: [], visits: 0 };
  if (!isObject(input) || input.type !== 'doc') {
    note(report, [], 'not-a-document', 'The root must be a node of type "doc"');
    return { doc: { type: 'doc', content: [] }, problems: report.problems };
  }
  checkAttributes(input, 'doc', [], report);
  const content: BlockNode[] = [];
  sanitizeBlocks(
    childNodes(input, [], report),
    (index) => childPath([], index),
    [],
    0,
    true,
    report,
    content,
  );
  return { doc: { type: 'doc', content }, problems: report.problems };
}

/**
 * The total repair, for the render path: whatever comes in, a valid document comes out.
 * The write path uses `richTextSchema`, which refuses what this would repair.
 */
export function sanitizeRichText(input: unknown): RichTextDoc {
  return inspectRichText(input).doc;
}
