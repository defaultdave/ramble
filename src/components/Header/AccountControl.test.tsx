import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountControl } from './AccountControl';
import { Header } from './Header';

// Behaviours under test:
// - signed out: a Sign in link to /sign-in and no sign-out form
// - signed in: a My bookings link to /account, and Sign out is a submit button in a form that posts to the end-session address, so it works with no script, and there is no sign-in link
// - the header shows the account control it is given, and nothing extra when it is given none

describe('AccountControl', () => {
  it('links a visitor to the sign-in page', () => {
    const { container } = render(<AccountControl signedIn={false} />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
    expect(screen.queryByRole('link', { name: 'My bookings' })).toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });

  it('gives a signed-in person a link to their bookings and a Sign out form that posts', () => {
    const { container } = render(<AccountControl signedIn />);

    expect(screen.getByRole('link', { name: 'My bookings' })).toHaveAttribute(
      'href',
      '/account',
    );

    const form = container.querySelector('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/api/auth/end-session');
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveAttribute(
      'type',
      'submit',
    );
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});

describe('Header account slot', () => {
  const props = {
    links: [{ label: 'Things to do', href: '/new-york/browse' }],
    giftsHref: '/gifts',
    searchLabel: 'Anywhere',
    searchHref: '/new-york/browse',
    menu: <button type="button">Menu</button>,
  };

  it('shows the control it is given', () => {
    render(<Header {...props} account={<AccountControl signedIn={false} />} />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows no account control when it is given none', () => {
    render(<Header {...props} />);

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });
});
