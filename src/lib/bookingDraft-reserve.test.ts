import { describe, expect, it } from 'vitest';
import {
  barView,
  choicesView,
  effectOf,
  sessionLabels,
  sessionOf,
} from './bookingDraft';
import {
  effectNotice,
  kayakOffer,
  optionId,
  session,
  run,
  sessionAt,
  pickSession,
} from './bookingDraft.fixtures';
import type { SessionSummary } from './holds';

// Behaviours under test, one per decision, branch or risk:
// - an answer to the reserve: held keeps waiting for the page change; paused switches every surface; a notice opens the sheet,
//   strikes a session that cannot be booked, and offers other dates that can then be chosen
// - the labels of a session on its own calendar and clock

const summary = (
  n: number,
  startsAt: string,
  spacesLeft: number,
): SessionSummary => ({
  sessionId: optionId(500 + n),
  startsAt,
  timeZone: 'America/New_York',
  spacesLeft,
});

describe('the reserve and its answers', () => {
  const chosen = () => run(kayakOffer, [pickSession(3)]);

  it('waits, and forgets the last answer, when a reserve starts', () => {
    const state = run(kayakOffer, [{ type: 'submitStarted' }], {
      ...chosen(),
      notice: effectNotice().notice,
    });
    expect(state.pending).toBe(true);
    expect(state.notice).toBeNull();
  });

  it('keeps waiting when the hold is placed, until the page changes', () => {
    const state = run(
      kayakOffer,
      [
        { type: 'submitStarted' },
        {
          type: 'submitDone',
          origin: 'phone',
          effect: { kind: 'held', href: '/checkout/1' },
        },
      ],
      chosen(),
    );
    expect(state.pending).toBe(true);
    expect(state.notice).toBeNull();
  });

  it('switches to paused when ops paused bookings', () => {
    const state = run(
      kayakOffer,
      [
        { type: 'submitStarted' },
        { type: 'submitDone', origin: 'phone', effect: { kind: 'paused' } },
      ],
      chosen(),
    );
    expect(state).toMatchObject({ paused: true, pending: false });
    expect(barView(kayakOffer, state)).toEqual({ state: 'paused' });
  });

  it('opens the sheet on the notice, and keeps the time when it can still be booked', () => {
    const state = run(
      kayakOffer,
      [{ type: 'submitDone', origin: 'phone', effect: effectNotice() }],
      chosen(),
    );
    expect(state.sheetOpen).toBe(true);
    expect(state.notice?.title).toBe('Those spaces just sold out');
    expect(state.sessionId).toBe(sessionAt(3));
  });

  it('keeps the sheet closed, and shows the notice, when the panel was refused', () => {
    const state = run(
      kayakOffer,
      [{ type: 'submitDone', origin: 'panel', effect: effectNotice() }],
      chosen(),
    );
    expect(state.sheetOpen).toBe(false);
    expect(state.notice?.title).toBe('Those spaces just sold out');
  });

  it('leaves a sheet that is already open open when the panel is refused', () => {
    const state = run(
      kayakOffer,
      [{ type: 'submitDone', origin: 'panel', effect: effectNotice() }],
      { ...chosen(), sheetOpen: true },
    );
    expect(state.sheetOpen).toBe(true);
  });

  it("strikes the session that cannot be booked, and its date when it was the date's last", () => {
    const solo = run(kayakOffer, [pickSession(5)]);
    const state = run(
      kayakOffer,
      [
        {
          type: 'submitDone',
          origin: 'phone',
          effect: { ...effectNotice(), closeSession: true },
        },
      ],
      solo,
    );
    expect(state.closed).toEqual([sessionAt(5)]);
    expect(state.sessionId).toBeNull();
    expect(state.date).toBeNull();
    expect(choicesView(kayakOffer, state).availableDates).not.toContain(
      '2026-10-25',
    );
  });

  it('keeps the date when another time on it remains', () => {
    const state = run(
      kayakOffer,
      [
        {
          type: 'submitDone',
          origin: 'phone',
          effect: { ...effectNotice(), closeSession: true },
        },
      ],
      chosen(),
    );
    expect(state.date).toBe('2026-10-24');
    expect(choicesView(kayakOffer, state).times?.map((t) => t.id)).toEqual([
      sessionAt(2),
    ]);
  });

  it('is sold out on the bar once every time is struck', () => {
    const one = {
      ...kayakOffer,
      sessions: [session(3, '2026-10-24', '5:30 PM EDT', 8)],
    };
    const state = run(
      one,
      [
        {
          type: 'submitDone',
          origin: 'phone',
          effect: { ...effectNotice(), closeSession: true },
        },
      ],
      run(one, [pickSession(3)]),
    );
    expect(barView(one, state)).toEqual({ state: 'sold-out' });
  });

  it('offers other dates after a sell-out, and chooses one of them with its own labels', () => {
    const other = summary(1, '2026-11-07T19:00:00Z', 6);
    const offered = run(
      kayakOffer,
      [
        {
          type: 'submitDone',
          origin: 'phone',
          effect: {
            ...effectNotice(),
            closeSession: true,
            alternatives: [other],
          },
        },
      ],
      chosen(),
    );
    expect(offered.alternatives).toEqual([other]);
    const state = run(
      kayakOffer,
      [{ type: 'chooseAlternative', summary: other }],
      offered,
    );
    expect(state.sessionId).toBe(other.sessionId);
    expect(state.date).toBe('2026-11-07');
    expect(sessionOf(kayakOffer, state)).toMatchObject({
      dayLabel: 'Sat, Nov 7',
      timeLabel: '2:00 PM EST',
      spacesLeft: 6,
      cancelNote: null,
    });
    expect(state.notice).toBeNull();
  });

  it('does not choose an alternative that is not bookable', () => {
    const gone = summary(2, '2026-11-08T19:00:00Z', 0);
    const before = chosen();
    expect(
      run(kayakOffer, [{ type: 'chooseAlternative', summary: gone }], before),
    ).toEqual(before);
  });

  it('opens and closes the sheet', () => {
    expect(run(kayakOffer, [{ type: 'openSheet' }]).sheetOpen).toBe(true);
    expect(
      run(kayakOffer, [{ type: 'openSheet' }, { type: 'closeSheet' }])
        .sheetOpen,
    ).toBe(false);
  });
});

describe('effectOf', () => {
  it('names the checkout and the device seat limit of the offer', () => {
    const offer = {
      ...kayakOffer,
      checkoutBase: '/pay/',
      deviceSeatLimit: 4,
    };
    expect(
      effectOf(offer, {
        status: 'held',
        holdId: 'h1',
        expiresAt: '2026-10-24T20:00:00Z',
        totalMinor: 6500,
        lines: [
          {
            priceOptionId: optionId(11),
            kind: 'adult',
            quantity: 1,
            unitPriceMinor: 6500,
            usesSpace: true,
            lineTotalMinor: 6500,
          },
        ],
      }),
    ).toEqual({ kind: 'held', href: '/pay/h1' });
    expect(
      effectOf(offer, { status: 'blocked', reason: 'device_limit' }),
    ).toMatchObject({
      notice: { body: expect.stringContaining('up to 4 spaces') as string },
    });
  });
});

describe('sessionLabels', () => {
  it("writes the date, day, and time on the session's own clock", () => {
    expect(
      sessionLabels(new Date('2026-10-25T02:30:00Z'), 'America/New_York'),
    ).toEqual({
      date: '2026-10-24',
      dayLabel: 'Sat, Oct 24',
      timeLabel: '10:30 PM EDT',
    });
  });
});
