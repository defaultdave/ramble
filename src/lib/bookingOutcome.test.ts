import { describe, expect, it } from 'vitest';
import {
  alternativeLabel,
  describeReserve,
  somethingWentWrong,
} from './bookingOutcome';
import type { ReserveResult, SessionSummary } from './holds';

// Behaviours under test, one per decision, branch or risk:
// - held goes to checkout at the hold's own address
// - every other status of the contract says what happened and what to do, and names no rule the guest cannot act on
// - sold out (S5) offers the other dates, or a way to similar experiences when there are none, and strikes the session
// - blocked: the device limit names the limit; a block with an end names the time in New York; a block without one is the bot refusal
// - unavailable: paused switches the surfaces; a cancelled or started session is struck; a gift reason is the generic answer
// - invalid: a bad session is struck, a bad party names the limits, prices that moved ask for a reload, anything else is generic
// - an alternative reads as day, time, and spaces on its own clock

const context = { checkoutBase: '/checkout/', maxSeats: 6, deviceSeatLimit: 6 };
const describeIt = (result: ReserveResult) => describeReserve(result, context);

const other: SessionSummary = {
  sessionId: '00000000-0000-4000-8000-000000000501',
  startsAt: '2026-11-07T19:00:00Z',
  timeZone: 'America/New_York',
  spacesLeft: 6,
};

const noticeOf = (result: ReserveResult) => {
  const effect = describeIt(result);
  if (effect.kind !== 'notice') throw new Error('Expected a notice');
  return effect;
};

describe('describeReserve', () => {
  it('goes to checkout at the hold when it was placed', () => {
    expect(
      describeIt({
        status: 'held',
        holdId: 'abc',
        expiresAt: '2026-10-24T20:00:00Z',
        totalMinor: 13000,
        lines: [
          {
            priceOptionId: 'p',
            kind: 'adult',
            quantity: 2,
            unitPriceMinor: 6500,
            usesSpace: true,
            lineTotalMinor: 13000,
          },
        ],
      }),
    ).toEqual({ kind: 'held', href: '/checkout/abc' });
  });

  it('offers the other dates after a sell-out, and strikes the session', () => {
    const effect = noticeOf({ status: 'sold_out', alternatives: [other] });
    expect(effect).toMatchObject({
      closeSession: true,
      alternatives: [other],
      notice: {
        title: 'Those spaces just sold out',
        body: expect.stringContaining('These other dates') as string,
        similar: false,
      },
    });
  });

  it('points to similar experiences after a sell-out with no other date', () => {
    const effect = noticeOf({ status: 'sold_out', alternatives: [] });
    expect(effect.alternatives).toEqual([]);
    expect(effect.notice.similar).toBe(true);
    expect(effect.notice.body).toContain('Try fewer guests');
  });

  it("names the device's own limit, not the size of one booking", () => {
    const effect = describeReserve(
      { status: 'blocked', reason: 'device_limit' },
      { ...context, maxSeats: 6, deviceSeatLimit: 4 },
    );
    expect(effect.kind === 'notice' && effect.notice.body).toContain(
      'up to 4 spaces at once',
    );
  });

  it('names the limit when the device holds as much as it may', () => {
    expect(
      noticeOf({ status: 'blocked', reason: 'device_limit' }).notice,
    ).toMatchObject({
      title: "You're holding as many spaces as one device can",
      body: expect.stringContaining('up to 6 spaces at once') as string,
    });
  });

  it("names the time a block ends, on New York's clock", () => {
    const { notice } = noticeOf({
      status: 'blocked',
      reason: 'too_many_holds',
      until: '2026-10-24T19:42:00Z',
    });
    expect(notice.title).toBe('Please wait a little');
    expect(notice.body).toContain('You can try again at 3:42 PM EDT.');
  });

  it('says a block with no end is a request that looked automated', () => {
    const { notice } = noticeOf({
      status: 'blocked',
      reason: 'too_many_holds',
    });
    expect(notice.title).toBe("We couldn't place your hold");
    expect(notice.body).toContain('looked automated');
    expect(notice.body).not.toContain('try again at');
  });

  it('switches to paused when bookings are paused', () => {
    expect(
      describeIt({ status: 'unavailable', reason: 'bookings_paused' }),
    ).toEqual({ kind: 'paused' });
  });

  it.each([
    ['session_cancelled', 'That session was cancelled', 'another date'],
    ['past', 'That session has already started', 'later'],
  ] as const)('strikes the session for %s', (reason, title, pick) => {
    const effect = noticeOf({ status: 'unavailable', reason });
    expect(effect.closeSession).toBe(true);
    expect(effect.notice.title).toBe(title);
    expect(effect.notice.body).toContain(pick);
  });

  it('gives the generic answer for a gift reason this page never sends', () => {
    expect(
      describeIt({ status: 'unavailable', reason: 'gift_not_valid' }),
    ).toBe(somethingWentWrong);
  });

  it('strikes a session the reserve refused as invalid', () => {
    const effect = noticeOf({
      status: 'invalid',
      fieldErrors: { sessionId: 'invalid' },
    });
    expect(effect.closeSession).toBe(true);
    expect(effect.notice.title).toBe("That date isn't available any more");
  });

  it('names the limits for a party size the reserve refused', () => {
    const effect = noticeOf({
      status: 'invalid',
      fieldErrors: { items: 'party_size' },
    });
    expect(effect.closeSession).toBe(false);
    expect(effect.notice.body).toBe('One booking takes 1 to 6 guests.');
  });

  it('asks for a reload when a price option is no longer offered', () => {
    expect(
      noticeOf({ status: 'invalid', fieldErrors: { items: 'not_offered' } })
        .notice.body,
    ).toContain('Reload the page');
  });

  it('gives the generic answer for any other invalid field', () => {
    expect(
      describeIt({ status: 'invalid', fieldErrors: { purpose: 'invalid' } }),
    ).toBe(somethingWentWrong);
  });
});

describe('somethingWentWrong', () => {
  it('says nothing was held and what to do', () => {
    expect(somethingWentWrong).toMatchObject({
      kind: 'notice',
      closeSession: false,
      notice: {
        tone: 'danger',
        body: expect.stringContaining('nothing was held') as string,
      },
    });
  });
});

describe('alternativeLabel', () => {
  it.each([
    [6, 'Sat, Nov 7 · 2:00 PM EST · 6 spaces'],
    [2, 'Sat, Nov 7 · 2:00 PM EST · 2 left'],
  ])('reads %i spaces as a button label', (spacesLeft, label) => {
    expect(alternativeLabel({ ...other, spacesLeft })).toBe(label);
  });
});
