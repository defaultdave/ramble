import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({
  issue: vi.fn(),
  connection: vi.fn(),
  logError: vi.fn(),
  notFound: vi.fn(),
  getExperiencePage: vi.fn(),
}));
vi.mock('@/server/formGuard', () => ({ issueFormGuardToken: server.issue }));
vi.mock('next/server', () => ({ connection: server.connection }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: server.notFound,
}));
vi.mock('@/server/experiencePage', () => ({
  getExperiencePage: server.getExperiencePage,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('./PrivateSessionForm', () => ({
  PrivateSessionForm: (props: {
    token: string;
    experienceId: string;
    experienceHref: string;
    minDate: string;
  }) => <p>{`form ${JSON.stringify(props)}`}</p>,
}));

import { PrivateSessionContent } from './PrivateSessionContent';

// Behaviours under test, one per decision, branch or risk:
// - the page has the h1, names the experience, and hands the form a token, the id, the way back, and today's New York date
// - an address that is not a slug and an id, or names no visible experience, is a not-found
// - the token is issued after the request is awaited, so building the site needs no secret
// - a failed read or token renders the error state with the h1 and a retry to this page, and logs only the error kind

const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const address = `pasta-night-${id}`;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  server.issue.mockReturnValue('123.sig');
  server.getExperiencePage.mockResolvedValue({
    experience: { name: 'Pasta night' },
  });
  server.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
});

describe('the private session content', () => {
  it('renders the heading, the experience name, and the form with what it needs', async () => {
    render(
      await PrivateSessionContent({ slugAndId: Promise.resolve(address) }),
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Request a private session',
      }),
    ).toBeVisible();
    expect(screen.getByText('Pasta night')).toBeVisible();
    const props = JSON.parse(
      screen.getByText(/^form /).textContent.slice(5),
    ) as Record<string, string>;
    expect(props).toMatchObject({
      token: '123.sig',
      experienceId: id,
      experienceHref: `/experiences/${address}`,
    });
    expect(props.minDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(server.connection).toHaveBeenCalledBefore(server.issue);
  });

  it('is a not-found for an address that is not a slug and an id', async () => {
    await expect(
      PrivateSessionContent({ slugAndId: Promise.resolve('sample') }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(server.getExperiencePage).not.toHaveBeenCalled();
  });

  it('is a not-found when no visible experience has the id', async () => {
    server.getExperiencePage.mockResolvedValue(null);

    await expect(
      PrivateSessionContent({ slugAndId: Promise.resolve(address) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each([
    [
      'the read fails',
      () => server.getExperiencePage.mockRejectedValue(new TypeError('down')),
    ],
    [
      'no token can be issued',
      () =>
        server.issue.mockImplementation(() => {
          throw new TypeError('FORM_GUARD_SECRET is not set');
        }),
    ],
  ])(
    'renders the error state and logs only the kind when %s',
    async (_label, arrange) => {
      arrange();

      render(
        await PrivateSessionContent({ slugAndId: Promise.resolve(address) }),
      );

      expect(server.logError).toHaveBeenCalledExactlyOnceWith(
        'The private session form could not be prepared',
        { digest: undefined, kind: 'TypeError' },
      );
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: 'Request a private session',
        }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Try again' }).closest('form'),
      ).toHaveAttribute('action', `/experiences/${address}/private-session`);
      expect(screen.queryByText(/^form /)).not.toBeInTheDocument();
    },
  );
});
