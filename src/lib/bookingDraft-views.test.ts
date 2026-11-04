import { describe, expect, it } from 'vitest';
import {
  barView,
  canContinue,
  choicesView,
  lowestPriceMinor,
  reserveInput,
  type BookingAction,
} from './bookingDraft';
import {
  effectNotice,
  familyOffer,
  kayakOffer,
  kidsOffer,
  optionId,
  session,
  start,
  run,
  sessionAt,
  pickDate,
  pickSession,
} from './bookingDraft.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - Continue is ready only for a bookable time in book mode while bookings run; the request lists only the options with a quantity
// - the bar: paused, sold out, date chosen, or the lowest price and next date

describe('choicesView status and missing', () => {
  it.each<[string, BookingAction[], string, string | null]>([
    ['nothing chosen', [], '', 'Choose a date to continue.'],
    [
      'a date chosen',
      [pickDate('2026-10-24')],
      'Times for Sat, Oct 24 are listed below.',
      'Choose a time to continue.',
    ],
    [
      'gift mode, where Continue is off for another reason',
      [{ type: 'setMode', mode: 'gift' }],
      '',
      null,
    ],
    [
      'a time chosen',
      [pickDate('2026-10-24'), pickSession(3)],
      "Who's coming is listed below.",
      null,
    ],
  ])('with %s', (_name, actions, status, missing) => {
    expect(choicesView(kayakOffer, run(kayakOffer, actions))).toMatchObject({
      status,
      missing,
    });
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
      { type: 'submitDone', origin: 'phone', effect: effectNotice() },
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
