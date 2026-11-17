'use client';

import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { safeLinkHref } from '@/lib/richText/href';
import { sanitizeRichText } from '@/lib/richText/sanitize';
import type { RichTextDoc } from '@/lib/richText/format';
import styles from './RichTextEditor.module.css';

export type RichTextEditorProps = {
  /** The form field that carries the document, as JSON, when the form is posted. */
  name: string;
  label: string;
  initial: RichTextDoc;
  errorText?: string;
};

const linkProblem =
  'Use a web, email or phone link, or a path on this site, such as /help.';

/**
 * Edits a document in the one format the site renders (`src/lib/richText`): the nodes and marks
 * the toolbar offers are the ones the format has, and every change is written through
 * `sanitizeRichText`, so the form posts what the server will accept. Ops only: it brings in
 * Tiptap, which no guest page loads.
 */
export function RichTextEditor({
  name,
  label,
  initial,
  errorText,
}: RichTextEditorProps) {
  const labelId = useId();
  const errorId = useId();
  const [value, setValue] = useState(() =>
    JSON.stringify(sanitizeRichText(initial)),
  );
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: false,
          isAllowedUri: (url) => safeLinkHref(url) !== null,
        },
      }),
    ],
    content: initial.content.length > 0 ? initial : '',
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
        ...(errorText ? { 'aria-describedby': errorId } : {}),
      },
    },
    onUpdate: ({ editor: updated }) => {
      setValue(JSON.stringify(sanitizeRichText(updated.getJSON())));
    },
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      link: current?.isActive('link') ?? false,
      h2: current?.isActive('heading', { level: 2 }) ?? false,
      h3: current?.isActive('heading', { level: 3 }) ?? false,
      bulletList: current?.isActive('bulletList') ?? false,
      orderedList: current?.isActive('orderedList') ?? false,
      blockquote: current?.isActive('blockquote') ?? false,
    }),
  });

  function openLink() {
    if (!editor) return;
    setLinkError(false);
    setLinkHref(
      typeof editor.getAttributes('link').href === 'string'
        ? (editor.getAttributes('link').href as string)
        : '',
    );
  }

  function applyLink() {
    if (!editor || linkHref === null) return;
    const href = safeLinkHref(linkHref);
    if (href === null) {
      setLinkError(true);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkHref(null);
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkHref(null);
  }

  // Enter in the address field applies it; it must not post the whole form.
  function linkKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyLink();
  }

  const tools = [
    {
      label: 'Bold',
      pressed: active?.bold,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      pressed: active?.italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Link',
      pressed: active?.link,
      run: openLink,
    },
    {
      label: 'Heading',
      pressed: active?.h2,
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Subheading',
      pressed: active?.h3,
      run: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: 'Bulleted list',
      pressed: active?.bulletList,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      pressed: active?.orderedList,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Quote',
      pressed: active?.blockquote,
      run: () => editor?.chain().focus().toggleBlockquote().run(),
    },
  ];

  return (
    <div className={styles.field}>
      <span className={styles.label} id={labelId}>
        {label}
      </span>
      <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
        {tools.map((tool) => (
          <Button
            key={tool.label}
            type="button"
            variant="secondary"
            aria-pressed={tool.pressed ?? false}
            disabled={!editor}
            onClick={tool.run}
          >
            {tool.label}
          </Button>
        ))}
      </div>
      {linkHref === null ? null : (
        <div className={styles.link}>
          <Input
            label="Link address"
            type="text"
            inputMode="url"
            autoComplete="off"
            value={linkHref}
            onChange={(event) => {
              setLinkHref(event.target.value);
              setLinkError(false);
            }}
            onKeyDown={linkKeyDown}
            {...(linkError ? { errorText: linkProblem } : {})}
          />
          <div className={styles.linkActions}>
            <Button type="button" onClick={applyLink}>
              Apply link
            </Button>
            <Button type="button" variant="secondary" onClick={removeLink}>
              Remove link
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setLinkHref(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div
        className={styles.surface}
        data-invalid={errorText ? 'true' : undefined}
      >
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <p className={styles.loading} role="status">
            Loading the editor…
          </p>
        )}
      </div>
      {errorText ? (
        <p className={styles.error} id={errorId}>
          {errorText}
        </p>
      ) : null}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
