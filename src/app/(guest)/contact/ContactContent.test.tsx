import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({
  issue: vi.fn(),
  connection: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/server/formGuard', () => ({ issueFormGuardToken: server.issue }));
vi.mock('next/server', () => ({ connection: server.connection }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('./ContactForm', () => ({
  ContactForm: ({ token }: { token: string }) => <p>{`form ${token}`}</p>,
}));

import { ContactContent } from './ContactContent';

// Behaviours under test, one per decision, branch or risk:
// - the page has the h1 "Contact", the form with a token issued for this request, and a link to help
// - the token is issued after the request is awaited, so building the site needs no secret
// - a token that cannot be issued renders the error state with the h1 and a retry, and logs only the error kind

beforeEach(() => {
  vi.resetAllMocks();
  server.issue.mockReturnValue('123.sig');
});

describe('the contact content', () => {
  it('renders the heading, the form with its token, and the help link', async () => {
    render(await ContactContent());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Contact' }),
    ).toBeVisible();
    expect(screen.getByText('form 123.sig')).toBeVisible();
    expect(screen.getByRole('link', { name: 'help center' })).toHaveAttribute(
      'href',
      '/help',
    );
    expect(server.connection).toHaveBeenCalledBefore(server.issue);
  });

  it('renders the error state and logs only the kind when no token can be issued', async () => {
    server.issue.mockImplementation(() => {
      throw new TypeError('FORM_GUARD_SECRET is not set');
    });

    render(await ContactContent());

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The contact form token could not be issued',
      { digest: undefined, kind: 'TypeError' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /FORM_GUARD_SECRET/,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Contact' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Try again' }).closest('form'),
    ).toHaveAttribute('action', '/contact');
    expect(screen.queryByText(/^form /)).not.toBeInTheDocument();
  });
});
