import { describe, expect, it } from 'vitest';
import {
  barView,
  bookingReducer,
  canContinue,
  choicesView,
  effectOf,
  initialState,
  lowestPriceMinor,
  reserveInput,
  sessionLabels,
  sessionOf,
  type BookingAction,
  type BookingOffer,
  type BookingState,
} from './bookingDraft';
import {
  familyOffer,
  kayakOffer,
  kidsOffer,
  optionId,
  session,
  twentyOneOffer,
} from './bookingDraft.fixtures';
import type { SessionSummary } from './holds';

// Behaviours under test, one per decision, branch or risk:
// - the start: nothing chosen, two adults; `?date=` chosen when the offer lists it with room, and its lone time with it; paused carried in
// - a date with no room, or none listed, cannot be chosen; choosing one clears the last answer
// - a time can be chosen, unchosen, and never when sold out or struck; the party is brought inside what the time has left
// - the party: an adult always comes; children only where offered; a free adult beside children needs a child; the cap is the spaces left
// - the total and its label follow the party's prices; the cancellation line is the chosen session's
// - Continue is ready only for a bookable time in book mode while bookings run; the request lists only the options with a quantity
// - the bar: paused, sold out, date chosen, or the lowest price and next date
// - an answer to the reserve: held keeps waiting for the page change; paused switches every surface; a notice opens the sheet,
//   strikes a session that cannot be booked, and offers other dates that can then be chosen
// - the labels of a session on its own calendar and clock

const start = (offer: BookingOffer = kayakOffer) => initialState(offer);
const run = (
  offer: BookingOffer,
  actions: BookingAction[],
  from: BookingState = start(offer),
) =>
  actions.reduce((state, action) => bookingReducer(offer, state, action), from);

const sessionAt = (n: number) => optionId(100 + n);
const pickDate = (date: string): BookingAction => ({
  type: 'chooseDate',
  date,
});
const pickSession = (n: number): BookingAction => ({
  type: 'chooseSession',
  sessionId: sessionAt(n),
});

describe('initialState', () => {
  it('starts with nothing chosen and two adults', () => {
    expect(start()).toMatchObject({
      mode: 'book',
      date: null,
      sessionId: null,
      adults: 2,
      children: 0,
      paused: false,
      sheetOpen: false,
      pending: false,
      notice: null,
    });
  });

  it('chooses the date in the address when it has several times, and no time', () => {
    const state = start({ ...kayakOffer, preselectedDate: '2026-10-24' });
    expect(state.date).toBe('2026-10-24');
    expect(state.sessionId).toBeNull();
  });

  it('chooses the lone time of the date in the address as well', () => {
    const state = start({ ...kayakOffer, preselectedDate: '2026-10-22' });
    expect(state.sessionId).toBe(sessionAt(1));
  });

  it.each([
    ['sold out', '2026-10-29'],
    ['not listed', '2026-12-01'],
  ])('ignores a date in the address that is %s', (_why, date) => {
    expect(start({ ...kayakOffer, preselectedDate: date }).date).toBeNull();
  });

  it('carries the pause the page was drawn with', () => {
    expect(start({ ...kayakOffer, paused: true }).paused).toBe(true);
  });
});

describe('chooseDate', () => {
  it('chooses a date with room and leaves the time to the guest when there are several', () => {
    const state = run(kayakOffer, [pickDate('2026-10-24')]);
    expect(state).toMatchObject({ date: '2026-10-24', sessionId: null });
  });

  it('chooses the only time on a date', () => {
    expect(run(kayakOffer, [pickDate('2026-10-25')]).sessionId).toBe(
      sessionAt(5),
    );
  });

  it('drops the time of the date left behind', () => {
    const state = run(kayakOffer, [
      pickDate('2026-10-22'),
      pickDate('2026-10-24'),
    ]);
    expect(state.sessionId).toBeNull();
  });

  it.each([
    ['sold out', '2026-10-29'],
    ['not listed', '2026-12-01'],
  ])('leaves the state alone for a date that is %s', (_why, date) => {
    const before = run(kayakOffer, [pickDate('2026-10-24')]);
    expect(run(kayakOffer, [pickDate(date)], before)).toEqual(before);
  });

  it('brings the party inside the spaces the lone time has left', () => {
    const state = run(kayakOffer, [pickDate('2026-10-25')]);
    expect(state.adults).toBe(2);
    const oneLeft = {
      ...kayakOffer,
      sessions: [session(1, '2026-10-22', '5:30 PM EDT', 1)],
    };
    expect(run(oneLeft, [pickDate('2026-10-22')]).adults).toBe(1);
  });
});

describe('chooseSession', () => {
  it('chooses a time, and its date with it', () => {
    const state = run(kayakOffer, [pickSession(3)]);
    expect(state).toMatchObject({
      sessionId: sessionAt(3),
      date: '2026-10-24',
    });
  });

  it('unchooses the time chosen again', () => {
    expect(run(kayakOffer, [pickSession(3), pickSession(3)]).sessionId).toBe(
      null,
    );
  });

  it('ignores a sold-out time and one that is not listed', () => {
    const before = run(kayakOffer, [pickSession(3)]);
    expect(run(kayakOffer, [pickSession(4)], before)).toEqual(before);
    expect(
      run(
        kayakOffer,
        [{ type: 'chooseSession', sessionId: optionId(999) }],
        before,
      ),
    ).toEqual(before);
  });

  it('clears the last answer', () => {
    const noticed: BookingState = {
      ...start(),
      notice: {
        tone: 'warning',
        title: 't',
        body: 'b',
        similar: false,
      },
    };
    expect(run(kayakOffer, [pickSession(3)], noticed).notice).toBeNull();
  });

  it('brings a party of four inside the two spaces a time has left', () => {
    const state = run(kayakOffer, [
      pickSession(3),
      { type: 'setAdults', value: 4 },
      pickSession(3),
      pickSession(5),
    ]);
    expect(state.adults).toBe(2);
  });
});

describe('the party', () => {
  const party = (
    offer: BookingOffer,
    actions: BookingAction[],
    n = 3,
  ): { adults: number; children: number } => {
    const state = run(offer, [pickSession(n), ...actions]);
    return { adults: state.adults, children: state.children };
  };

  it.each([
    ['below one adult', { type: 'setAdults', value: 0 }, 1],
    ['within the room', { type: 'setAdults', value: 5 }, 5],
    ['above six', { type: 'setAdults', value: 9 }, 6],
  ] as const)('keeps adults %s inside 1 to 6', (_name, action, adults) => {
    expect(party(kayakOffer, [action]).adults).toBe(adults);
  });

  it('stops at the spaces the time has left', () => {
    expect(party(kayakOffer, [{ type: 'setAdults', value: 6 }], 5).adults).toBe(
      2,
    );
  });

  it('takes no children where none are offered', () => {
    expect(
      party(kayakOffer, [{ type: 'setChildren', value: 2 }]).children,
    ).toBe(0);
    expect(
      party(twentyOneOffer, [{ type: 'setChildren', value: 2 }]).children,
    ).toBe(0);
  });

  it('shares the cap between adults and children where both take a space', () => {
    const state = party(familyOffer, [
      { type: 'setAdults', value: 3 },
      { type: 'setChildren', value: 5 },
    ]);
    expect(state).toEqual({ adults: 3, children: 3 });
  });

  it('gives way on the children first, then the adults, when the time has fewer spaces than the party', () => {
    const state = party(
      familyOffer,
      [
        { type: 'setAdults', value: 3 },
        { type: 'setChildren', value: 3 },
        pickSession(3),
        pickSession(5),
      ],
      3,
    );
    expect(state).toEqual({ adults: 2, children: 0 });
  });

  it('needs a child beside a free adult who takes no space', () => {
    expect(party(kidsOffer, [{ type: 'setChildren', value: 0 }])).toEqual({
      adults: 2,
      children: 1,
    });
  });

  it('counts only the children toward the cap where the adult takes no space', () => {
    expect(
      party(kidsOffer, [
        { type: 'setAdults', value: 3 },
        { type: 'setChildren', value: 6 },
      ]),
    ).toEqual({ adults: 3, children: 6 });
  });

  it('describes each stepper with its limits and hint', () => {
    const view = choicesView(kidsOffer, run(kidsOffer, [pickSession(3)]));
    expect(view.party).toMatchObject({
      adults: { value: 2, min: 1, max: 6, hint: null },
      children: { value: 1, min: 1, max: 6, hint: 'Ages 5 to 10' },
      note: "You'll add each child's age at checkout.",
      ageAlert: null,
    });
  });

  it('names a lone stepper Guests with the age line, and says 21 and over in an alert', () => {
    const plain = choicesView(kayakOffer, run(kayakOffer, [pickSession(3)]));
    expect(plain.party).toMatchObject({
      adults: { hint: 'Ages 14 and up' },
      children: null,
      note: null,
      ageAlert: null,
    });
    const strict = choicesView(
      twentyOneOffer,
      run(twentyOneOffer, [pickSession(3)]),
    );
    expect(strict.party?.ageAlert).toEqual({
      title: '21 and over',
      body: expect.stringContaining('ID is checked at the door') as string,
    });
  });

  it('lowers the largest party a stepper allows with the other stepper', () => {
    const view = choicesView(
      familyOffer,
      run(familyOffer, [pickSession(3), { type: 'setChildren', value: 4 }]),
    );
    expect(view.party?.adults.max).toBe(2);
    expect(view.party?.children?.max).toBe(4);
  });
});

describe('the total', () => {
  const summaryOf = (offer: BookingOffer, actions: BookingAction[]) =>
    choicesView(offer, run(offer, [pickSession(3), ...actions])).summary;

  it('says one price times the guests, and charges the tickets', () => {
    expect(summaryOf(kayakOffer, [])).toEqual({
      when: 'Sat, Oct 24 · 5:30 PM EDT',
      guests: 2,
      totalMinor: 13000,
      label: '$65 × 2 guests',
      terms: 'Free cancellation until Sat, Oct 24, 5:30 PM EDT.',
    });
  });

  it('says one guest for one', () => {
    expect(
      summaryOf(kayakOffer, [{ type: 'setAdults', value: 1 }])?.label,
    ).toBe('$65 × 1 guest');
  });

  it('names adults and children once children come, and prices each on its own option', () => {
    expect(
      summaryOf(familyOffer, [
        { type: 'setChildren', value: 1 },
        { type: 'setAdults', value: 2 },
      ]),
    ).toMatchObject({
      label: '2 adults, 1 child',
      totalMinor: 2 * 4000 + 2500,
      guests: 3,
    });
  });

  it('charges only the children where the adult is free', () => {
    expect(
      summaryOf(kidsOffer, [{ type: 'setChildren', value: 2 }]),
    ).toMatchObject({
      label: '2 adults, 2 children',
      totalMinor: 9000,
    });
  });

  it('has no terms line when the session has no deadline to state', () => {
    const offer = {
      ...kayakOffer,
      sessions: [
        { ...session(3, '2026-10-24', '5:30 PM EDT', 8), cancelNote: null },
      ],
    };
    expect(
      choicesView(offer, run(offer, [pickSession(3)])).summary?.terms,
    ).toBeNull();
  });

  it('shows none in gift mode or before a time is chosen', () => {
    expect(
      choicesView(
        kayakOffer,
        run(kayakOffer, [pickSession(3), { type: 'setMode', mode: 'gift' }]),
      ).summary,
    ).toBeNull();
    expect(choicesView(kayakOffer, start()).summary).toBeNull();
  });
});

describe('choicesView', () => {
  it('offers the dates with room, and the times on the chosen date', () => {
    const view = choicesView(
      kayakOffer,
      run(kayakOffer, [pickDate('2026-10-24'), pickSession(3)]),
    );
    expect(view.availableDates).toEqual([
      '2026-10-22',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(view.timesHeading).toBe('Time on Sat, Oct 24');
    expect(view.times).toEqual([
      {
        id: sessionAt(2),
        time: '4:00 PM EDT',
        spacesLeft: 10,
        selected: false,
      },
      { id: sessionAt(3), time: '5:30 PM EDT', spacesLeft: 8, selected: true },
    ]);
  });

  it('has no times and no party before a date is chosen', () => {
    const view = choicesView(kayakOffer, start());
    expect(view).toMatchObject({
      date: null,
      times: null,
      timesHeading: null,
      party: null,
    });
  });

  it.each([true, false])(
    'shows the book or gift switch only while gifts are on (%s)',
    (giftsEnabled) => {
      expect(
        choicesView({ ...kayakOffer, giftsEnabled }, start()).showModeSwitch,
      ).toBe(giftsEnabled);
    },
  );

  it('clears the last answer when the mode changes', () => {
    const state = run(kayakOffer, [
      { type: 'submitDone', effect: effectNotice() },
      { type: 'setMode', mode: 'gift' },
    ]);
    expect(state.notice).toBeNull();
    expect(state.mode).toBe('gift');
  });
});

describe('canContinue and reserveInput', () => {
  it('is ready with a bookable time in book mode, and asks for the adults only', () => {
    const state = run(kayakOffer, [pickSession(3)]);
    expect(canContinue(kayakOffer, state)).toBe(true);
    expect(reserveInput(kayakOffer, state)).toEqual({
      sessionId: sessionAt(3),
      items: [{ priceOptionId: optionId(11), quantity: 2 }],
      purpose: 'booking',
    });
  });

  it('lists each option with a quantity, the free adult included', () => {
    const state = run(kidsOffer, [
      pickSession(3),
      { type: 'setChildren', value: 2 },
    ]);
    expect(reserveInput(kidsOffer, state)?.items).toEqual([
      { priceOptionId: optionId(21), quantity: 2 },
      { priceOptionId: optionId(22), quantity: 2 },
    ]);
  });

  it.each([
    ['no time is chosen', start()],
    [
      'the mode is gift',
      run(kayakOffer, [pickSession(3), { type: 'setMode', mode: 'gift' }]),
    ],
    [
      'bookings are paused',
      { ...run(kayakOffer, [pickSession(3)]), paused: true },
    ],
  ])('is not ready when %s', (_why, state) => {
    expect(canContinue(kayakOffer, state)).toBe(false);
    expect(reserveInput(kayakOffer, state)).toBeNull();
  });

  it('is not ready for a time that was struck', () => {
    const state = {
      ...run(kayakOffer, [pickSession(3)]),
      closed: [sessionAt(3)],
    };
    expect(canContinue(kayakOffer, state)).toBe(false);
  });
});

describe('barView', () => {
  it('is paused whatever else is chosen', () => {
    expect(
      barView(kayakOffer, {
        ...run(kayakOffer, [pickSession(3)]),
        paused: true,
      }),
    ).toEqual({ state: 'paused' });
  });

  it('is sold out when no time has room', () => {
    const full = {
      ...kayakOffer,
      sessions: [session(4, '2026-10-24', '7:00 PM EDT', 0)],
    };
    expect(barView(full, start(full))).toEqual({ state: 'sold-out' });
    expect(barView({ ...kayakOffer, sessions: [] }, start())).toEqual({
      state: 'sold-out',
    });
  });

  it('shows what is chosen once a time is', () => {
    expect(barView(kayakOffer, run(kayakOffer, [pickSession(3)]))).toEqual({
      state: 'date-chosen',
      when: 'Sat, Oct 24 · 5:30 PM EDT',
      guests: 2,
      totalMinor: 13000,
    });
  });

  it('shows the lowest price and the next open date before that, and in gift mode', () => {
    const expected = {
      state: 'default',
      priceMinor: 6500,
      nextDate: 'Thu, Oct 22',
    };
    expect(barView(kayakOffer, start())).toEqual(expected);
    expect(
      barView(
        kayakOffer,
        run(kayakOffer, [pickSession(3), { type: 'setMode', mode: 'gift' }]),
      ),
    ).toEqual(expected);
  });
});

describe('lowestPriceMinor', () => {
  it.each([
    ['one price', kayakOffer, 6500],
    ['an adult and a child that both take a space', familyOffer, 2500],
    ['a free adult who takes no space', kidsOffer, 4500],
  ])('is %s', (_name, offer, price) => {
    expect(lowestPriceMinor(offer)).toBe(price);
  });

  it('falls back to every option when none takes a space', () => {
    expect(
      lowestPriceMinor({
        ...kayakOffer,
        options: [
          { id: optionId(1), kind: 'adult', priceMinor: 900, usesSpace: false },
        ],
      }),
    ).toBe(900);
  });
});

function effectNotice() {
  return {
    kind: 'notice' as const,
    notice: {
      tone: 'warning' as const,
      title: 'Those spaces just sold out',
      body: 'x',
      similar: false,
    },
    closeSession: false,
    alternatives: [],
  };
}

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
        { type: 'submitDone', effect: { kind: 'held', href: '/checkout/1' } },
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
        { type: 'submitDone', effect: { kind: 'paused' } },
      ],
      chosen(),
    );
    expect(state).toMatchObject({ paused: true, pending: false });
    expect(barView(kayakOffer, state)).toEqual({ state: 'paused' });
  });

  it('opens the sheet on the notice, and keeps the time when it can still be booked', () => {
    const state = run(
      kayakOffer,
      [{ type: 'submitDone', effect: effectNotice() }],
      chosen(),
    );
    expect(state.sheetOpen).toBe(true);
    expect(state.notice?.title).toBe('Those spaces just sold out');
    expect(state.sessionId).toBe(sessionAt(3));
  });

  it("strikes the session that cannot be booked, and its date when it was the date's last", () => {
    const solo = run(kayakOffer, [pickSession(5)]);
    const state = run(
      kayakOffer,
      [
        {
          type: 'submitDone',
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
  it('names the checkout and the seat limit of the offer', () => {
    const offer = { ...kayakOffer, checkoutBase: '/pay/', maxSeats: 4 };
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
