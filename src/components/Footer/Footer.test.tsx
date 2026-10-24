import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { Footer } from './Footer';

const props = {
  linkGroups: [
    {
      title: 'Explore',
      links: [
        { label: 'Gift guide', href: '/gifts' },
        { label: 'Ramble Picks', href: '/picks/this-week' },
      ],
    },
    { title: 'Help', links: [{ label: 'Help center', href: '/help' }] },
  ],
  tagline: 'The friend who always knows what to do in New York.',
  copyright: '© 2026 Ramble. Made in Brooklyn.',
};

describe('Footer', () => {
  it('groups its links under their titles', () => {
    render(<Footer {...props} />);
    const nav = screen.getByRole('navigation', { name: 'Footer' });
    expect(
      within(nav)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Explore', 'Help']);
    expect(
      within(nav).getByRole('link', { name: 'Help center' }),
    ).toHaveAttribute('href', '/help');
  });

  it('is the page footer landmark with the tagline and copyright', () => {
    render(<Footer {...props} />);
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent(props.tagline);
    expect(footer).toHaveTextContent(props.copyright);
  });
});

describe('Footer props', () => {
  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof Footer>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Footer>>().not.toHaveProperty('style');
  });
});
