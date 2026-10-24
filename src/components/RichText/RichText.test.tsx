import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RichTextDoc } from '@/lib/richText/format';
import { RichText } from './RichText';

function renderDoc(content: unknown) {
  return render(<RichText content={content as RichTextDoc} />);
}

const paragraph = (value: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value, ...(marks && { marks }) }],
});

describe('RichText', () => {
  it('renders every node of the format as its HTML element', () => {
    const { container } = renderDoc({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'Refunds' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'First' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Second' },
          ],
        },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph('Bullet')] }],
        },
        {
          type: 'orderedList',
          content: [{ type: 'listItem', content: [paragraph('Step')] }],
        },
        { type: 'blockquote', content: [paragraph('Quoted')] },
        { type: 'horizontalRule' },
      ],
    });

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
      'Refunds',
    );
    expect(container.querySelector('br')).toBeInTheDocument();
    const [bullets, steps] = screen.getAllByRole('list');
    expect(bullets?.tagName).toBe('UL');
    expect(steps?.tagName).toBe('OL');
    expect(
      within(bullets as HTMLElement).getByRole('listitem'),
    ).toHaveTextContent('Bullet');
    expect(container.querySelector('blockquote')).toHaveTextContent('Quoted');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('renders bold and italic text', () => {
    const { container } = renderDoc({
      type: 'doc',
      content: [paragraph('Loud', [{ type: 'bold' }, { type: 'italic' }])],
    });
    expect(container.querySelector('strong')).toHaveTextContent('Loud');
    expect(container.querySelector('em')).toHaveTextContent('Loud');
  });

  it('adds rel to a link to another site and not to one on this site', () => {
    renderDoc({
      type: 'doc',
      content: [
        paragraph('Elsewhere', [
          { type: 'link', attrs: { href: 'https://example.com/x' } },
        ]),
        paragraph('Here', [{ type: 'link', attrs: { href: '/help' } }]),
      ],
    });
    const elsewhere = screen.getByRole('link', { name: 'Elsewhere' });
    expect(elsewhere).toHaveAttribute('href', 'https://example.com/x');
    expect(elsewhere).toHaveAttribute('rel', 'noopener noreferrer');
    expect(elsewhere).not.toHaveAttribute('target');
    const here = screen.getByRole('link', { name: 'Here' });
    expect(here).toHaveAttribute('href', '/help');
    expect(here).not.toHaveAttribute('rel');
  });

  it('renders text as text, so markup in it is shown and not run', () => {
    const { container } = renderDoc({
      type: 'doc',
      content: [paragraph('<img src=x onerror=alert(1)><script>x()</script>')],
    });
    expect(container.querySelector('img, script')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  describe('input that the sanitizer would change', () => {
    it('renders a script link as plain text', () => {
      renderDoc({
        type: 'doc',
        content: [
          paragraph('Click me', [
            { type: 'link', attrs: { href: 'javascript:alert(1)' } },
          ]),
        ],
      });
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.getByText('Click me')).toBeInTheDocument();
    });

    it.each([
      [
        'an unknown node',
        { type: 'image', attrs: { src: 'https://example.com/a.png' } },
      ],
      [
        'a raw HTML node',
        { type: 'html', attrs: { html: '<script>x()</script>' } },
      ],
    ])('does not throw on %s and renders nothing for it', (_label, node) => {
      const { container } = renderDoc({
        type: 'doc',
        content: [node, paragraph('Kept')],
      });
      expect(container.querySelector('img, script')).toBeNull();
      expect(container).toHaveTextContent('Kept');
    });

    it('keeps the page heading outline by clamping a level 1 heading', () => {
      renderDoc({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Big' }],
          },
        ],
      });
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'Big',
      );
    });
  });

  it.each([
    ['an empty document', { type: 'doc', content: [] }],
    ['something that is not a document', 'hello'],
  ])('renders nothing for %s', (_label, content) => {
    const { container } = renderDoc(content);
    expect(container).toBeEmptyDOMElement();
  });
});
