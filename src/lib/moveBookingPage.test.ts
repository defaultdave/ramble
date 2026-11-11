import { describe, expect, it } from 'vitest';
import { orderA } from './bookingEmails.fixtures';
import type { CancelFacts } from './cancelBooking';
import {
  managePageState,
  manageReadOutcome,
  wantsMovePicker,
  type ManageView,
} from './manageBooking';
import { manageViewOf } from './manageBooking.fixtures';
import {
  isMoveNoticeCode,
  moveNotice,
  moveNoticeCodes,
  movePickerPath,
  movePrompt,
  moveResultPath,
  type MoveBookingResult,
  type MoveSubject,
  type MoveTarget,
} from './moveBooking';

// Behaviours under test, one per decision, branch, or risk (what the manage page says about moving):
// - the offer is on a booking that can be moved and on no other (closed window, gift-paid, started, cancelled)
// - the picker is closed until the query opens it, and opens with exactly the dates the verdict accepts
// - only `?move=1` exactly opens the picker, only on a booking that has the offer
// - a move's answer is shown only on a booking it could be about, and outranks a cancel's answer in one query
// - every move status has its own notice; the redirect carries a move's statuses in `moved` and the cancel's own in `result`
// - the offer names the deadline, or says nothing of it when there is none

const token = 'A'.repeat(43);
const facts: CancelFacts = {
  status: 'confirmed',
  kind: 'booking',
  ticketSubtotalMinor: 21_500,
  taxMinor: 1_912,
  totalMinor: 23_412,
  amountDueMinor: 23_412,
  commissionMinor: 3_225,
  commissionRateBps: 1_500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
  giftAppliedMinor: 0,
  freeCancelUntil: orderA.freeCancelUntil,
  manageTokenVersion: 1,
  sessionStartsAt: orderA.startsAt,
  seats: 3,
};
const inWindow = new Date('2026-11-05T12:00:00Z');
const subject: MoveSubject = {
  facts,
  sessionId: 'a0000000-0000-4000-8000-0000000000aa',
  experienceId: 'e0000000-0000-4000-8000-0000000000ee',
  experienceStatus: 'live',
  fullRefundHoursBefore: 24,
};
const target = (
  id: string,
  startsAt: string,
  spacesLeft: number,
): MoveTarget => ({
  id,
  experienceId: subject.experienceId,
  status: 'scheduled',
  startsAt: new Date(startsAt),
  timeZone: 'America/New_York',
  spacesLeft,
});
const picker = {
  subject,
  candidates: [
    target('b0000000-0000-4000-8000-000000000001', '2026-11-14T21:00:00Z', 6),
    target('b0000000-0000-4000-8000-000000000002', '2026-11-21T21:00:00Z', 3),
  ],
};

function active(view: ManageView) {
  if (view.kind !== 'active') throw new Error('not an active view');
  return view;
}

describe('the offer on the manage page', () => {
  it('is on a booking inside the window, with the picker closed', () => {
    const { move } = active(manageViewOf(orderA, facts, inWindow));

    expect(move).toMatchObject({
      heading: 'Need a different date?',
      linkLabel: 'Move to another date',
      picker: null,
    });
    expect(move?.body).toBe(
      'You can move this booking to another date of the same experience at the same price until Fri, Nov 6, 4:00 PM EST.',
    );
  });

  it.each([
    ['after the window closed', facts, new Date('2026-11-06T22:00:00Z')],
    [
      'for a gift-paid booking',
      { ...facts, giftAppliedMinor: 4_000, amountDueMinor: 19_412 },
      inWindow,
    ],
  ])('is not there %s, but the cancel is', (_name, over, at) => {
    const view = active(manageViewOf(orderA, over, at));

    expect(view.move).toBeNull();
    expect(view.prompt.buttonLabel).toBeTruthy();
  });

  it('is on no cancelled or started booking', () => {
    expect(
      manageViewOf(
        { ...orderA, status: 'cancelled' },
        { ...facts, status: 'cancelled' },
        inWindow,
      ).kind,
    ).toBe('cancelled');
    expect(manageViewOf(orderA, facts, orderA.startsAt).kind).toBe('closed');
  });

  it('opens the picker with the dates the verdict accepts, and not the one inside the window', () => {
    const view = active(
      manageViewOf(orderA, facts, inWindow, {
        subject,
        candidates: [
          ...picker.candidates,
          target(
            'b0000000-0000-4000-8000-000000000003',
            '2026-11-06T09:00:00Z',
            9,
          ),
        ],
      }),
    );

    expect(
      view.move?.picker?.choices.map((choice) => choice.sessionId),
    ).toEqual([
      'b0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000002',
    ]);
  });

  it('opens the picker with no dates when none has room', () => {
    const view = active(
      manageViewOf(orderA, facts, inWindow, { subject, candidates: [] }),
    );

    expect(view.move?.picker).toMatchObject({ choices: [] });
  });

  it('shows no picker for a booking outside the terms even when the page read the dates', () => {
    const view = active(
      manageViewOf(orderA, facts, new Date('2026-11-06T22:00:00Z'), picker),
    );

    expect(view.move).toBeNull();
  });

  it('reads the picker through the route outcome and shows none when it was not read', () => {
    const outcome = manageReadOutcome({
      order: orderA,
      facts,
      now: inWindow,
    });

    expect(
      outcome.kind === 'ok' && active(outcome.view).move?.picker,
    ).toBeNull();
  });
});

describe('movePrompt', () => {
  it('says nothing of a deadline when the order has none', () => {
    expect(
      movePrompt({
        freeCancelUntil: null,
        timeZone: 'America/New_York',
        choices: null,
      }).body,
    ).toBe(
      'You can move this booking to another date of the same experience at the same price.',
    );
  });

  it('names the same-price note and both buttons when the picker is open', () => {
    const { picker: open } = movePrompt({
      freeCancelUntil: null,
      timeZone: 'America/New_York',
      choices: [],
    });

    expect(open).toMatchObject({
      note: 'The price stays the same: nothing more to pay and nothing refunded.',
      submitLabel: 'Move my booking',
      keepLabel: 'Keep my current date',
    });
  });
});

describe('the query', () => {
  const view = manageViewOf(orderA, facts, inWindow, picker);

  it.each([
    ['1', true],
    [['1'], true],
    ['0', false],
    ['true', false],
    [['1', '1'], false],
    [undefined, false],
  ])('move=%j opens the picker: %s', (value, opens) => {
    expect(wantsMovePicker(value === undefined ? {} : { move: value })).toBe(
      opens,
    );
  });

  it('opens the picker on a booking that has the offer', () => {
    expect(managePageState(view, { move: '1' }).moving).toBe(true);
  });

  it('does not open it on a booking with no offer', () => {
    const closed = manageViewOf(
      orderA,
      facts,
      new Date('2026-11-06T22:00:00Z'),
    );

    expect(managePageState(closed, { move: '1' }).moving).toBe(false);
    expect(
      managePageState(manageViewOf(orderA, facts, orderA.startsAt), {
        move: '1',
      }).moving,
    ).toBe(false);
  });

  it('does not open the cancel step with it, nor the picker with the cancel step', () => {
    expect(managePageState(view, { move: '1' }).confirming).toBe(false);
    expect(managePageState(view, { confirm: '1' }).moving).toBe(false);
  });

  it.each(moveNoticeCodes)(
    'shows the answer %s on an active booking',
    (code) => {
      expect(managePageState(view, { moved: code }).notice).toEqual(
        moveNotice(code),
      );
    },
  );

  it('shows "moved" and the same-date family on no cancelled booking, and "not movable" on every one', () => {
    const cancelled = manageViewOf(
      { ...orderA, status: 'cancelled' },
      { ...facts, status: 'cancelled' },
      inWindow,
    );
    const closed = manageViewOf(orderA, facts, orderA.startsAt);

    for (const code of [
      'moved',
      'same_date',
      'date_unavailable',
      'sold_out',
      'too_soon',
    ]) {
      expect(managePageState(cancelled, { moved: code }).notice?.title).toBe(
        'This booking is already cancelled',
      );
    }
    expect(managePageState(cancelled, { moved: 'not_movable' }).notice).toEqual(
      moveNotice('not_movable'),
    );
    expect(managePageState(closed, { moved: 'not_movable' }).notice).toEqual(
      moveNotice('not_movable'),
    );
  });

  it('shows a move answer over a cancel answer, and ignores a code that is not a move status', () => {
    expect(
      managePageState(view, { moved: 'sold_out', result: 'terms_changed' })
        .notice,
    ).toEqual(moveNotice('sold_out'));
    expect(managePageState(view, { moved: 'cancelled' }).notice).toBeNull();
    expect(
      managePageState(view, { moved: ['moved', 'moved'] }).notice,
    ).toBeNull();
  });
});

describe('the notices', () => {
  it('give every status its own words, and none uses an em dash', () => {
    const titles = moveNoticeCodes.map((code) => moveNotice(code).title);

    expect(new Set(titles).size).toBe(moveNoticeCodes.length);
    for (const code of moveNoticeCodes) {
      const { title, body } = moveNotice(code);
      expect(`${title} ${body}`).not.toContain('—');
    }
  });

  it('is a success only for a move that happened', () => {
    expect(
      moveNoticeCodes.filter((code) => moveNotice(code).tone === 'success'),
    ).toEqual(['moved']);
  });

  it.each(['not_found', 'rate_limited', 'cancelled', '', 'MOVED'])(
    'does not take %j for a move status',
    (value) => {
      expect(isMoveNoticeCode(value)).toBe(false);
    },
  );
});

describe('the paths', () => {
  it('opens the picker on the same page', () => {
    expect(movePickerPath(token)).toBe(`/manage/${token}?move=1`);
  });

  it.each(moveNoticeCodes)('carries %s in `moved`', (status) => {
    expect(moveResultPath(token, { status })).toBe(
      `/manage/${token}?moved=${status}`,
    );
  });

  it.each([
    [{ status: 'not_found' }, 'not_found'],
    [{ status: 'rate_limited', retryAfterSeconds: 60 }, 'rate_limited'],
  ] as [MoveBookingResult, string][])(
    'carries the cancel statuses %j in `result`, which the page already says',
    (result, code) => {
      expect(moveResultPath(token, result)).toBe(
        `/manage/${token}?result=${code}`,
      );
    },
  );
});
