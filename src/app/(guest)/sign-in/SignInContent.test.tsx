import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/actions/signIn', () => ({ requestSignInLink: vi.fn() }));

import { ConfirmContent } from './confirm/ConfirmContent';
import { SignInContent } from './SignInContent';

// Behaviours under test, one per decision, branch or risk:
// - the sign-in page shows the form with its checked destination in a hidden field: a safe path is kept, an unsafe one is home, a repeated parameter uses the first
// - the sign-in page shows the link problem its error names, above the form, and none without an error
// - the confirm page, given a token, shows the button with the token and destination in hidden fields, and renders no link that could use the token
// - the confirm page, given a missing or odd token, shows the expired-or-used notice and a way to ask for a new link that keeps the destination

type Query = Record<string, string | string[] | undefined>;
const query = (value: Query) => Promise.resolve(value);

async function signIn(value: Query) {
  render(await SignInContent({ searchParams: query(value) }));
}

async function confirm(value: Query) {
  return render(await ConfirmContent({ searchParams: query(value) }));
}

describe('the sign-in page', () => {
  it.each([
    ['a safe path', { next: '/account' }, '/account'],
    ['an unsafe address', { next: '//evil.com' }, '/'],
    ['a repeated parameter', { next: ['/a', '//evil.com'] }, '/a'],
    ['no destination', {}, '/'],
  ])('carries %s as the destination', async (_label, value, expected) => {
    await signIn(value);

    expect(document.querySelector('input[name="next"]')).toHaveValue(expected);
    expect(
      screen.getByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['INVALID_TOKEN', 'expired or was already used'],
    ['failed_to_create_session', 'We could not sign you in'],
  ])('shows the problem for %s above the form', async (error, text) => {
    await signIn({ error });

    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows no problem without an error', async () => {
    await signIn({});

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the confirm page', () => {
  it('shows one button that carries the token and the destination, and no link', async () => {
    const { container } = await confirm({
      token: 'AbC123',
      next: '/account',
    });

    expect(container.querySelector('input[name="token"]')).toHaveValue(
      'AbC123',
    );
    expect(container.querySelector('input[name="next"]')).toHaveValue(
      '/account',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toEqual([]);
  });

  it.each([
    ['no token', {}],
    ['a token with a symbol', { token: 'a-b' }],
    ['a token that is too long', { token: 'a'.repeat(200) }],
  ])('shows the expired-or-used notice for %s', async (_label, value) => {
    await confirm({ ...value, next: '/account' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'expired or was already used',
    );
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Ask for a new link' }),
    ).toHaveAttribute('href', '/sign-in?next=%2Faccount');
  });
});
