import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RichTextDoc } from '@/lib/richText/format';
import { RichTextEditor } from './RichTextEditor';

// Behaviours under test:
// - the editor is a labelled textbox with a formatting group, and the form field carries the document as JSON
// - a change to the document reaches the form field, in the sanitized format
// - a link the format refuses is not applied, and its address field says why
// - Enter in the link address field applies the link and does not post the form
// - opening the link panel focuses its address field, and Cancel gives focus back to the editor
// - the link button says whether the panel is open, and a refused address is announced
// - headings, lists and bold text typed in the editor reach the form field whole
// - a refused field is named in the error text and the textbox points at it

// jsdom does no layout, and ProseMirror asks for the rectangles of a range when it scrolls the cursor into view.
beforeAll(() => {
  const noRects = () => [] as unknown as DOMRectList;
  Range.prototype.getClientRects = noRects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const doc: RichTextDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Hello there' }] },
  ],
};

function field(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[name="body"]');
  if (!input) throw new Error('no form field');
  return input;
}

async function renderEditor(errorText?: string) {
  const view = render(
    <RichTextEditor
      name="body"
      label="Body"
      initial={doc}
      {...(errorText ? { errorText } : {})}
    />,
  );
  await screen.findByRole('textbox', { name: 'Body' });
  return view;
}

// Tiptap hands focus back to the editor on the next animation frame after a toolbar click, as a
// person's next keystroke comes later; a script that types at once would land before it.
async function tool(name: string) {
  await userEvent.click(screen.getByRole('button', { name }));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

describe('RichTextEditor', () => {
  it('shows a labelled textbox, a toolbar, and the document in the form field', async () => {
    const { container } = await renderEditor();
    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveTextContent(
      'Hello there',
    );
    expect(screen.getByRole('group', { name: 'Formatting' })).toBeVisible();
    expect(JSON.parse(field(container).value)).toEqual(doc);
  });

  it('writes a change to the form field in the format', async () => {
    const { container } = await renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Heading' }));
    await waitFor(() => {
      expect(JSON.parse(field(container).value)).toEqual({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Hello there' }],
          },
        ],
      });
    });
    expect(screen.getByRole('button', { name: 'Heading' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('refuses a link the format does not allow and says why', async () => {
    await renderEditor();
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link address' }),
      'javascript:alert(1)',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply link' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Use a web, email or phone link/,
    );
    expect(screen.getByRole('textbox', { name: 'Link address' })).toBeInvalid();
    expect(screen.getByRole('textbox', { name: 'Link address' })).toBeVisible();
  });

  it('applies a link on Enter without posting the form', async () => {
    let posted = false;
    const { container } = render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          posted = true;
        }}
      >
        <RichTextEditor name="body" label="Body" initial={doc} />
      </form>,
    );
    await screen.findByRole('textbox', { name: 'Body' });
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Link address' }),
      '/help{Enter}',
    );
    expect(posted).toBe(false);
    expect(
      screen.queryByRole('textbox', { name: 'Link address' }),
    ).not.toBeInTheDocument();
    expect(field(container).value).toBe(JSON.stringify(doc));
  });

  it('names a refused field, announces it, and marks the textbox invalid', async () => {
    await renderEditor('Add some text to the body.');
    const message = screen.getByRole('alert');
    expect(message).toHaveTextContent('Add some text to the body.');
    const textbox = screen.getByRole('textbox', { name: 'Body' });
    expect(textbox).toHaveAttribute('aria-describedby', message.id);
    expect(textbox).toHaveAttribute('aria-invalid', 'true');
  });

  it('focuses the address field on open, and Cancel returns focus to the editor', async () => {
    await renderEditor();
    const link = screen.getByRole('button', { name: 'Link' });
    expect(link).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(link);
    expect(link).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Link address' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('textbox', { name: 'Link address' }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Body' })).toHaveFocus();
    });
    expect(link).toHaveAttribute('aria-expanded', 'false');
  });

  it('writes a heading, a list and bold text typed in the editor to the form field whole', async () => {
    const { container } = render(
      <RichTextEditor
        name="body"
        label="Body"
        initial={{ type: 'doc', content: [] }}
      />,
    );
    const editable = await screen.findByRole('textbox', { name: 'Body' });
    await tool('Heading');
    await userEvent.type(editable, 'Refunds{Enter}', { skipClick: true });
    await tool('Bold');
    await userEvent.type(editable, 'bold words', { skipClick: true });
    await tool('Bold');
    await userEvent.type(editable, '{Enter}', { skipClick: true });
    await tool('Bulleted list');
    await userEvent.type(editable, 'First item', { skipClick: true });

    await waitFor(() => {
      expect(JSON.parse(field(container).value)).toEqual({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Refunds' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'bold words', marks: [{ type: 'bold' }] },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'First item' }],
                  },
                ],
              },
            ],
          },
        ],
      });
    });
  });
});
