import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '@/lib/pages/experience.fixtures';
import { UpcomingSessionsContent } from './UpcomingSessionsContent';

// Behaviours under test, one per decision, branch or risk:
// - the dates are read for the experience as of the current minute, once the query is known
// - each listed date is a row with its time on the session's clock, its spaces, and the price; a sold-out one is listed without a link
// - the date in the address selects its rows
// - no upcoming sessions says so
// - a failed read logs only the digest and kind, and shows the dates' error state, which retries at the page's own address
// - a framework control-flow error is rethrown and not logged

const server = vi.hoisted(() => ({ read: vi.fn(), logError: vi.fn() }));
vi.mock('@/server/upcomingSessions', () => ({
  readUpcomingSessions: server.read,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));

const upcoming = {
  experienceId: id(1),
  priceOptions: [{ priceMinor: 6500, usesSpace: true }],
};
const session = (n: number, iso: string) => ({
  id: id(n),
  startsAt: new Date(iso),
  timeZone: 'America/New_York',
});
const props = (query: Record<string, string> = {}) => ({
  upcoming,
  bookHref: '/checkout/demo',
  searchParams: Promise.resolve(query),
  retryHref: '/experiences/sunset-kayak-1',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  server.read.mockResolvedValue([
    { session: session(10, '2026-10-24T21:30:00Z'), spacesLeft: 8 },
    { session: session(11, '2026-10-25T21:30:00Z'), spacesLeft: 0 },
  ]);
});

describe('UpcomingSessionsContent', () => {
  it('reads the dates of the experience as of the current minute', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T14:03:41Z') });

    await UpcomingSessionsContent(props());

    expect(server.read).toHaveBeenCalledExactlyOnceWith(
      id(1),
      '2026-10-20T14:03:00.000Z',
    );
  });

  it('draws a row per date, and lists the sold-out one without a link', async () => {
    render(await UpcomingSessionsContent(props()));

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const open = within(rows[0] as HTMLElement).getByRole('link');
    expect(open).toHaveTextContent('Sat, Oct 24 · 5:30 PM EDT');
    expect(open).toHaveTextContent('8 spaces');
    expect(open).toHaveTextContent('$65');
    expect(open).toHaveAttribute('href', '/checkout/demo');
    expect(rows[1]).toHaveTextContent('Sun, Oct 25 · 5:30 PM EDT');
    expect(rows[1]).toHaveTextContent('Sold out');
    expect(within(rows[1] as HTMLElement).queryByRole('link')).toBeNull();
  });

  it("marks the rows on the address's date", async () => {
    render(await UpcomingSessionsContent(props({ date: '2026-10-25' })));

    const current = document.querySelectorAll('[aria-current="date"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Sun, Oct 25');
  });

  it('says so when there are no upcoming dates', async () => {
    server.read.mockResolvedValue([]);

    render(await UpcomingSessionsContent(props()));

    expect(screen.getByText(/No dates are open/)).toBeInTheDocument();
  });

  it('logs only the digest and kind of a failed read, and retries at the own address', async () => {
    server.read.mockRejectedValue(
      Object.assign(new Error('Failed query: select ... params: secret-id'), {
        digest: '1234567',
      }),
    );

    render(await UpcomingSessionsContent(props()));

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The upcoming dates could not be read',
      { digest: '1234567', kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load the dates",
    );
    expect(
      screen
        .getByRole('button', { name: 'Check availability' })
        .closest('form'),
    ).toHaveAttribute('action', '/experiences/sunset-kayak-1');
  });

  it('rethrows a framework control-flow error and logs nothing', async () => {
    const { notFound } = await import('next/navigation');
    server.read.mockImplementation(() => {
      notFound();
    });

    await expect(UpcomingSessionsContent(props())).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404') as string,
    });
    expect(server.logError).not.toHaveBeenCalled();
  });
});
