import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { ComponentProps } from 'react';
import { Header } from './Header';

const links = [
  { label: 'Things to do', href: '/new-york/browse' },
  { label: 'Gift guide', href: '/gifts' },
];

const defaults = {
  links,
  giftsHref: '/gifts',
  searchLabel: 'Anywhere · This weekend · 2 guests',
  searchHref: '/new-york/browse',
  menu: <button type="button">Menu</button>,
};

describe('Header default', () => {
  it('links the logo home', () => {
    render(<Header {...defaults} />);
    expect(screen.getByRole('link', { name: 'Ramble home' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('lists the main links', () => {
    render(<Header {...defaults} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/new-york/browse', '/gifts']);
  });

  it('links the search summary to browse', () => {
    render(<Header {...defaults} />);
    expect(
      screen.getByRole('link', {
        name: 'Search: Anywhere · This weekend · 2 guests',
      }),
    ).toHaveAttribute('href', '/new-york/browse');
  });

  it('renders the menu slot', () => {
    render(<Header {...defaults} />);
    expect(screen.getByRole('button', { name: 'Menu' })).toBeVisible();
  });

  it('is one banner landmark', () => {
    render(<Header {...defaults} />);
    expect(screen.getAllByRole('banner')).toHaveLength(1);
  });

  it('shows the Gifts action by default', () => {
    render(<Header {...defaults} />);
    expect(screen.getByRole('link', { name: 'Gifts' })).toHaveAttribute(
      'href',
      '/gifts',
    );
  });

  it('hides the Gifts action when showGifts is false', () => {
    render(<Header {...defaults} showGifts={false} />);
    expect(
      screen.queryByRole('link', { name: 'Gifts' }),
    ).not.toBeInTheDocument();
  });
});

describe('Header checkout', () => {
  const checkout = (
    <Header
      variant="checkout"
      holdTimer={<div role="timer">Spaces held for 9:42</div>}
    />
  );

  it('renders the hold timer slot and leaves out navigation and the menu', () => {
    render(checkout);
    expect(screen.getByRole('timer')).toHaveTextContent('Spaces held for 9:42');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is one banner landmark', () => {
    render(checkout);
    expect(screen.getAllByRole('banner')).toHaveLength(1);
  });
});

describe('Header props', () => {
  it('rejects className and style', () => {
    expectTypeOf<ComponentProps<typeof Header>>().not.toHaveProperty(
      'className',
    );
    expectTypeOf<ComponentProps<typeof Header>>().not.toHaveProperty('style');
  });
});
