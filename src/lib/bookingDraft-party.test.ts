import { describe, expect, it } from 'vitest';
import {
  choicesView,
  type BookingAction,
  type BookingOffer,
} from './bookingDraft';
import {
  familyOffer,
  kayakOffer,
  kidsOffer,
  session,
  twentyOneOffer,
  start,
  run,
  pickSession,
} from './bookingDraft.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the party: an adult always comes; children only where offered; a free adult beside children needs a child; the cap is the spaces left
// - a party the spaces left cut down says so in a notice; a party that fits says nothing
// - the total and its label follow the party's prices; the cancellation line is the chosen session's

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

  it('says so when the spaces left took people off the party, and not when it fits', () => {
    const trimmed = run(kayakOffer, [
      pickSession(3),
      { type: 'setAdults', value: 4 },
      pickSession(5),
    ]);
    expect(trimmed.notice).toEqual({
      tone: 'info',
      title: 'We changed your party',
      body: 'That time has 2 spaces left, so your party is now 2 adults.',
      similar: false,
    });
    expect(run(kayakOffer, [pickSession(3)]).notice).toBeNull();
    expect(
      run(kayakOffer, [{ type: 'setAdults', value: 5 }, pickSession(3)]).notice,
    ).toBeNull();
  });

  it('names the children kept in the notice, and clears it on the next change', () => {
    const trimmed = run(familyOffer, [
      pickSession(3),
      { type: 'setAdults', value: 2 },
      { type: 'setChildren', value: 3 },
      pickSession(5),
    ]);
    expect(trimmed.notice?.body).toBe(
      'That time has 2 spaces left, so your party is now 2 adults.',
    );
    expect(
      run(familyOffer, [{ type: 'setAdults', value: 1 }], trimmed).notice,
    ).toBeNull();
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
