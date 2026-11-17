// Text on the host's session-cancellation page: what the host reads before confirming, the states a
// session can be in when the page opens, and the answer after each attempt.

import type { HostCancelNoticeCode } from '../hostCancelSession';
import type { NoticeText } from '../opsForm';

export const hostCancelCopy = {
  title: 'Cancel session',
  linkLabel: 'Cancel and refund guests',
  backLabel: 'Back to your sessions',
  impactHeading: 'Who this affects',
  explainer:
    'Cancelling refunds every booking on this session in full and emails each guest. It cannot be undone.',
  /** The labels of the session's facts, in the order the page lists them. */
  factLabels: {
    experience: 'Experience',
    when: 'When',
    seats: 'Seats',
    status: 'Status',
  },
  /** The seats line, as "2 of 10 seats sold". */
  seatsSold: (sold: string, allocation: string) =>
    `${sold} of ${allocation} seats sold`,
  formHeading: 'Confirm the cancellation',
  confirmLabel: 'I have read who this affects',
  submitLabel: 'Cancel session and refund its bookings',
  /** What stands in place of the form when the session cannot be cancelled now. */
  states: {
    blocked:
      'This session cannot be cancelled here. Contact Ramble support and they will cancel it for you.',
    started: 'This session has already started, so it cannot be cancelled.',
    completed: 'This session has already taken place.',
    cancelled: 'This session is cancelled. Its guests were refunded and told.',
  },
} as const;

export const hostCancelNotices = {
  cancelled: {
    tone: 'success',
    title:
      'Session cancelled. Its bookings are refunded and its guests emailed.',
  },
  cancelled_payments_left: {
    tone: 'info',
    title:
      'Session cancelled. A payment still in progress will be refunded when it lands.',
  },
  already_cancelled: {
    tone: 'info',
    title: 'That session was already cancelled; anything left over was tidied.',
  },
  completed: {
    tone: 'warning',
    title: 'That session has already taken place.',
  },
  not_found: {
    tone: 'warning',
    title: 'That session is no longer there. Go back to your sessions.',
  },
  blocked: {
    tone: 'danger',
    title:
      'Nothing was cancelled: a booking cannot be refunded in full here. Contact Ramble support.',
  },
  stale: {
    tone: 'warning',
    title:
      'This changed since you read it, so nothing was cancelled. Read who it affects again.',
  },
  in_the_past: {
    tone: 'warning',
    title: 'That time has already passed.',
  },
  invalid: {
    tone: 'danger',
    title: 'Tick the box to confirm you read who this affects, then try again.',
  },
} as const satisfies Record<HostCancelNoticeCode, NoticeText>;
