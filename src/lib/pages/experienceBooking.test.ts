import { describe, expect, it } from 'vitest';
import { basicsOf, kayakOffer } from '../bookingDraft.fixtures';
import type { SessionWithSpaces } from '../upcomingSessions';
import { id } from './experience.fixtures';
import {
  buildBookingOffer,
  cancelNote,
  offeredSessions,
} from './experienceBooking';

// Behaviours under test, one per decision, branch or risk:
// - the cancellation line names the deadline on the session's clock while free, and says the window has closed after it
// - a session guests cannot see (no spaces figure) is left out; a full one stays, with its spaces; each is labelled on its own calendar and clock
// - the offer carries the basics, the venue's date for the calendar, and the sessions
// - `?date=` is kept only when a listed session is on that date, whatever its spaces

const zone = 'America/New_York';
const entry = (
  n: number,
  startsAt: string,
  spacesLeft: number | null,
): SessionWithSpaces => ({
  session: { id: id(n), startsAt: new Date(startsAt), timeZone: zone },
  spacesLeft,
});

const now = new Date('2026-10-20T14:03:00Z');

describe('cancelNote', () => {
  it('names the deadline while the booking is still free to cancel', () => {
    expect(cancelNote(24, new Date('2026-10-24T21:30:00Z'), now, zone)).toBe(
      'Free cancellation until Fri, Oct 23, 5:30 PM EDT.',
    );
  });

  it('says the window has closed once the deadline has passed', () => {
    expect(cancelNote(24, new Date('2026-10-21T01:00:00Z'), now, zone)).toBe(
      'The free cancellation window has closed, so this booking will not be refundable.',
    );
  });
});

describe('offeredSessions', () => {
  it('leaves out a session no guest can see, keeps a full one, and labels each on its own clock', () => {
    const offered = offeredSessions(
      [
        entry(10, '2026-10-24T21:30:00Z', 8),
        entry(11, '2026-10-25T21:30:00Z', null),
        entry(12, '2026-10-26T01:30:00Z', 0),
      ],
      24,
      now,
    );
    expect(offered).toEqual([
      {
        id: id(10),
        date: '2026-10-24',
        dayLabel: 'Sat, Oct 24',
        timeLabel: '5:30 PM EDT',
        spacesLeft: 8,
        cancelNote: 'Free cancellation until Fri, Oct 23, 5:30 PM EDT.',
      },
      {
        id: id(12),
        date: '2026-10-25',
        dayLabel: 'Sun, Oct 25',
        timeLabel: '9:30 PM EDT',
        spacesLeft: 0,
        cancelNote: 'Free cancellation until Sat, Oct 24, 9:30 PM EDT.',
      },
    ]);
  });
});

describe('buildBookingOffer', () => {
  const basics = basicsOf(kayakOffer, 24);
  const build = (selectedDate: string | null) =>
    buildBookingOffer({
      basics,
      sessions: [
        entry(10, '2026-10-24T21:30:00Z', 8),
        entry(11, '2026-10-25T21:30:00Z', 0),
      ],
      selectedDate,
      asOf: '2026-10-20T14:03:00.000Z',
    });

  it("carries the basics, the venue's date, and the sessions, without the refund hours", () => {
    const offer = build(null);
    expect(offer).toMatchObject({
      experienceId: kayakOffer.experienceId,
      title: kayakOffer.title,
      today: '2026-10-20',
      preselectedDate: null,
    });
    expect(offer.sessions).toHaveLength(2);
    expect(offer).not.toHaveProperty('fullRefundHoursBefore');
  });

  it("takes the venue's date, not UTC's, near midnight", () => {
    const late = buildBookingOffer({
      basics,
      sessions: [],
      selectedDate: null,
      asOf: '2026-10-21T02:30:00.000Z',
    });
    expect(late.today).toBe('2026-10-20');
  });

  it.each([
    ['a listed date', '2026-10-24', '2026-10-24'],
    ['a listed date that is full', '2026-10-25', '2026-10-25'],
    ['a date with no session', '2026-10-30', null],
  ])('keeps ?date= only for %s', (_name, selected, kept) => {
    expect(build(selected).preselectedDate).toBe(kept);
  });
});
