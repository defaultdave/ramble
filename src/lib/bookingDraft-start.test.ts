import { describe, expect, it } from 'vitest';
import type { BookingState } from './bookingDraft';
import {
  kayakOffer,
  optionId,
  session,
  start,
  run,
  sessionAt,
  pickDate,
  pickSession,
} from './bookingDraft.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the start: nothing chosen, two adults; `?date=` chosen when the offer lists it with room, and its lone time with it; paused carried in
// - a date with no room, or none listed, cannot be chosen; choosing one clears the last answer
// - a time can be chosen, unchosen, and never when sold out or struck; the party is brought inside what the time has left

describe('initialState', () => {
  it('says so when the lone time of ?date= has fewer spaces than the default party', () => {
    const state = start({
      ...kayakOffer,
      preselectedDate: '2026-10-25',
      sessions: kayakOffer.sessions.map((s) =>
        s.id === sessionAt(5) ? { ...s, spacesLeft: 1 } : s,
      ),
    });
    expect(state).toMatchObject({ sessionId: sessionAt(5), adults: 1 });
    expect(state.notice?.body).toBe(
      'That time has 1 space left, so your party is now 1 adult.',
    );
  });

  it('says nothing when the default party fits the lone time of ?date=', () => {
    expect(
      start({ ...kayakOffer, preselectedDate: '2026-10-25' }).notice,
    ).toBeNull();
  });

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
