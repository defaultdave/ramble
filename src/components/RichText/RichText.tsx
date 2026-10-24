// Server-only so that no client module can import this file: the build fails first.
// It keeps the renderer out of the guest bundle, and the editor never comes into it.
import 'server-only';
import { renderJSONContentToReactElement } from '@tiptap/static-renderer/json/react';
import type { ReactNode } from 'react';
import type {
  HeadingLevel,
  RichTextDoc,
  RichTextMark,
  RichTextNode,
} from '@/lib/richText/format';
import { isWebUrl } from '@/lib/richText/href';
import { sanitizeRichText } from '@/lib/richText/sanitize';
import styles from './RichText.module.css';

const headingTag = {
  2: 'h2',
  3: 'h3',
  4: 'h4',
} as const satisfies Record<HeadingLevel, 'h2' | 'h3' | 'h4'>;

type NodeProps = { node: RichTextNode; children?: ReactNode };
type MarkProps = { mark: RichTextMark; children?: ReactNode };

// The mapping is the whole schema on the render side. A node or mark missing from it
// throws, which is right: the sanitizer already removed everything unlisted.
const nodeMapping = {
  doc: ({ children }: NodeProps) => <>{children}</>,
  paragraph: ({ children }: NodeProps) => <p>{children}</p>,
  heading: ({ node, children }: NodeProps) => {
    if (node.type !== 'heading') return null;
    const Heading = headingTag[node.attrs.level];
    return <Heading>{children}</Heading>;
  },
  bulletList: ({ children }: NodeProps) => <ul>{children}</ul>,
  orderedList: ({ children }: NodeProps) => <ol>{children}</ol>,
  listItem: ({ children }: NodeProps) => <li>{children}</li>,
  blockquote: ({ children }: NodeProps) => <blockquote>{children}</blockquote>,
  horizontalRule: () => <hr />,
  hardBreak: () => <br />,
  text: ({ node }: NodeProps) => (node.type === 'text' ? node.text : null),
};

const markMapping = {
  bold: ({ children }: MarkProps) => <strong>{children}</strong>,
  italic: ({ children }: MarkProps) => <em>{children}</em>,
  link: ({ mark, children }: MarkProps) => {
    if (mark.type !== 'link') return <>{children}</>;
    const { href } = mark.attrs;
    return (
      <a href={href} rel={isWebUrl(href) ? 'noopener noreferrer' : undefined}>
        {children}
      </a>
    );
  },
};

export type RichTextProps = { content: RichTextDoc };

export function RichText({ content }: RichTextProps) {
  const doc = sanitizeRichText(content);
  if (doc.content.length === 0) return null;

  // The renderer numbers its elements as it goes, so each render gets its own.
  const render = renderJSONContentToReactElement<RichTextMark, RichTextNode>({
    nodeMapping,
    markMapping,
  });

  return <div className={styles.richText}>{render({ content: doc })}</div>;
}
