import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { basicsOf, kayakOffer } from '@/lib/bookingDraft.fixtures';
import { id } from '@/lib/pages/experience.fixtures';
import { BookingContent } from './BookingContent';

// Behaviours under test, one per decision, branch or risk:
// - the sessions are read for the experience as of the current minute, once the query is known, in the booking window (60 sessions, 60 days)
// - the bar, its sheet, and the panel are all handed the offer built from them, with the venue's date and ?date= kept when listed
// - a failed read logs only the digest and kind, and shows the dates' error state in the panel's column with the way back
// - a framework control-flow error is rethrown and not logged

const server = vi.hoisted(() => ({ read: vi.fn(), logError: vi.fn() }));
vi.mock('@/server/upcomingSessions', () => ({
  readUpcomingSessions: server.read,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));

// The islands are client components with their own tests; here they only show what they were handed.
const handed = vi.hoisted(() => ({ offers: [] as unknown[] }));
vi.mock('@/components/BookingBar/BookingBarIsland', () => ({
  BookingBarIsland: ({ offer }: { offer: unknown }) => {
    handed.offers.push(offer);
    return <p>Bar stub</p>;
  },
}));
vi.mock('@/components/BookingSheet/BookingSheetIsland', () => ({
  BookingSheetIsland: ({ offer }: { offer: unknown }) => {
    handed.offers.push(offer);
    return <p>Sheet stub</p>;
  },
}));
vi.mock('@/components/BookingPanel/BookingPanelIsland', () => ({
  BookingPanelIsland: ({ offer }: { offer: unknown }) => {
    handed.offers.push(offer);
    return <p>Panel stub</p>;
  },
}));

const basics = basicsOf({ ...kayakOffer, experienceId: id(1) });
const session = (n: number, iso: string) => ({
  id: id(n),
  startsAt: new Date(iso),
  timeZone: 'America/New_York',
});
const props = (query: Record<string, string> = {}) => ({
  basics,
  searchParams: Promise.resolve(query),
  retryHref: '/experiences/sunset-kayak-1',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  handed.offers.length = 0;
  server.read.mockResolvedValue([
    { session: session(10, '2026-10-24T21:30:00Z'), spacesLeft: 8 },
    { session: session(11, '2026-10-25T21:30:00Z'), spacesLeft: 0 },
  ]);
});

describe('BookingContent', () => {
  it('reads the sessions of the experience as of the current minute', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T14:03:41Z') });

    await BookingContent(props());

    expect(server.read).toHaveBeenCalledExactlyOnceWith(
      id(1),
      '2026-10-20T14:03:00.000Z',
      { limit: 60, windowDays: 60 },
    );
  });

  it('hands the bar, the sheet, and the panel one offer, with the date from the address', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T14:03:41Z') });

    render(await BookingContent(props({ date: '2026-10-24' })));

    expect(screen.getByText('Bar stub')).toBeVisible();
    expect(screen.getByText('Sheet stub')).toBeVisible();
    expect(screen.getByText('Panel stub')).toBeVisible();
    expect(handed.offers).toHaveLength(3);
    expect(handed.offers[0]).toBe(handed.offers[1]);
    expect(handed.offers[0]).toBe(handed.offers[2]);
    expect(handed.offers[0]).toMatchObject({
      experienceId: id(1),
      today: '2026-10-20',
      preselectedDate: '2026-10-24',
      sessions: [
        { id: id(10), spacesLeft: 8, timeLabel: '5:30 PM EDT' },
        { id: id(11), spacesLeft: 0 },
      ],
    });
  });

  it('ignores a date in the address that no session is on', async () => {
    render(await BookingContent(props({ date: '2026-12-25' })));

    expect(handed.offers[0]).toMatchObject({ preselectedDate: null });
  });

  it("logs only the digest and kind of a failed read, and shows the dates' error state in the panel column", async () => {
    server.read.mockRejectedValue(
      Object.assign(new Error('Failed query: params: secret-id'), {
        cause: new Error('connection to secret-host refused'),
      }),
    );

    render(await BookingContent(props()));

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The booking dates could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load the dates");
    expect(
      within(alert.parentElement as HTMLElement)
        .getByRole('button', { name: 'Check availability' })
        .closest('form'),
    ).toHaveAttribute('action', '/experiences/sunset-kayak-1');
    expect(handed.offers).toEqual([]);
  });

  it('rethrows a framework control-flow error and logs nothing', async () => {
    server.read.mockImplementation(() => {
      notFound();
    });

    await expect(BookingContent(props())).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404') as string,
    });
    expect(server.logError).not.toHaveBeenCalled();
  });
});
