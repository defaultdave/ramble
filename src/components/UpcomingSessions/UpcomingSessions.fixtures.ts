import {
  buildUpcomingSessions,
  type SessionWithSpaces,
  type UpcomingSessionsView,
} from '@/lib/upcomingSessions';

const zone = 'America/New_York';
const sessionId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The Figma rows: Saturday 5:30 PM Eastern, and the days after it. */
const entry = (
  n: number,
  startsAt: string,
  spacesLeft: number | null,
): SessionWithSpaces => ({
  session: { id: sessionId(n), startsAt: new Date(startsAt), timeZone: zone },
  spacesLeft,
});

const price = [{ priceMinor: 6500, usesSpace: true }];

function view(
  sessions: SessionWithSpaces[],
  selectedDate: string | null = null,
): UpcomingSessionsView {
  return buildUpcomingSessions({
    sessions,
    priceOptions: price,
    selectedDate,
    pageHref: '/experiences/sunset-kayak-1',
  });
}

export const withSpaces = view([
  entry(1, '2026-10-24T21:30:00Z', 8),
  entry(2, '2026-10-25T21:30:00Z', 12),
  entry(3, '2026-10-31T21:30:00Z', 6),
  entry(4, '2026-11-01T21:30:00Z', 10),
]);

/** Figma frame 03: an open date, one with two left, and a sold-out one that stays listed. */
export const mixed = view([
  entry(1, '2026-10-24T21:30:00Z', 8),
  entry(2, '2026-10-25T21:30:00Z', 2),
  entry(3, '2026-10-31T21:30:00Z', 0),
  entry(4, '2026-11-01T21:30:00Z', 10),
]);

export const lowSpaces = view([
  entry(1, '2026-10-24T21:30:00Z', 3),
  entry(2, '2026-10-25T21:30:00Z', 1),
  entry(3, '2026-10-31T21:30:00Z', 5),
]);

export const soldOut = view([
  entry(1, '2026-10-24T21:30:00Z', 0),
  entry(2, '2026-10-25T21:30:00Z', -1),
  entry(3, '2026-10-31T21:30:00Z', 4),
]);

/** The address asked for Sunday, October 25. */
export const withSelectedDate = view(
  [
    entry(1, '2026-10-24T21:30:00Z', 8),
    entry(2, '2026-10-25T17:00:00Z', 5),
    entry(3, '2026-10-25T21:30:00Z', 2),
  ],
  '2026-10-25',
);

export const none = view([]);
