import { hostCancelCopy, hostCancelNotices } from './copy/hostSessions';
import {
  parseNotice,
  type FormGetter,
  type FormResult,
  type NoticeText,
} from './opsForm';
import {
  cancelBlocked,
  cancelGate,
  cancelOutcomeNotice,
  impactIsCurrent,
  impactView,
  parseImpactForm,
  type CancelNoticeCode,
  type Impact,
  type ImpactFormInput,
  type ImpactView,
  type OpsCancelOutcome,
} from './opsSessions';
import { sessionStatusLabels, type sessionStatuses } from './sessions';
import { zonedDeadlineLabel } from './zonedLabels';

// The host's cancellation of a booked session: what the page says about the session and the guests
// it affects, whether the form may be sent, and the notice an attempt ends in. What cancelling does
// is `cancelSession.ts`, and the impact is read and worded as ops reads it (`opsSessions.ts`).

export type HostCancelRecord = {
  id: string;
  experienceName: string;
  startsAt: Date;
  timeZone: string;
  allocation: number;
  seatsSold: number;
  status: (typeof sessionStatuses)[number];
};

/** What the data layer hands over: the session, what cancelling it would do as it stands, and the database's time. */
export type HostCancelData = {
  session: HostCancelRecord;
  impact: Impact;
  at: Date;
};

/** `ready` shows the form; every other state says why there is none. A cancelled session is shown as such, so a repeat visit never offers to cancel twice. */
export type HostCancelState =
  'ready' | 'blocked' | 'started' | 'completed' | 'cancelled';

export function hostCancelState(data: HostCancelData): HostCancelState {
  const { session, impact, at } = data;
  if (session.status === 'cancelled') return 'cancelled';
  if (session.status === 'completed') return 'completed';
  if (cancelGate(session, at) === 'ended') return 'started';
  return cancelBlocked(impact) ? 'blocked' : 'ready';
}

/** What the host's cancel is refused for before anything is written, or `proceed` to hand it to `cancelSession`. */
export type HostCancelCheck = 'ended' | 'blocked' | 'stale' | 'proceed';

/**
 * Whether a host's cancel may go ahead. A started session is over, a booking that cannot be
 * refunded in full blocks it, and an impact that moved since it was read is stale. A session that
 * is already cancelled is not a changed impact, so it proceeds whatever fingerprint was shown: a
 * repeat of a submit that went through finishes what a failed run left. `status` is read after
 * the impact, so a submit that landed in between shows as cancelled.
 */
export function hostCancelCheck(input: {
  status: HostCancelRecord['status'];
  gate: ReturnType<typeof cancelGate>;
  impact: Impact;
  fingerprint: string;
}): HostCancelCheck {
  if (input.gate === 'ended') return 'ended';
  if (cancelBlocked(input.impact)) return 'blocked';
  if (
    input.status !== 'cancelled' &&
    !impactIsCurrent(input.fingerprint, input.impact)
  ) {
    return 'stale';
  }
  return 'proceed';
}

export type HostCancelView = {
  id: string;
  title: string;
  whenLabel: string;
  experienceName: string;
  seatsLabel: string;
  statusLabel: string;
  state: HostCancelState;
  /** The sentence that stands in place of the form; null when the form is shown. */
  stateText: string | null;
  impact: ImpactView;
};

export function buildHostCancelView(data: HostCancelData): HostCancelView {
  const { session } = data;
  const state = hostCancelState(data);
  const whenLabel = zonedDeadlineLabel(session.startsAt, session.timeZone);
  return {
    id: session.id,
    title: `${session.experienceName}, ${whenLabel}`,
    whenLabel,
    experienceName: session.experienceName,
    seatsLabel: hostCancelCopy.seatsSold(
      String(session.seatsSold),
      String(session.allocation),
    ),
    statusLabel: sessionStatusLabels[session.status],
    state,
    stateText: state === 'ready' ? null : hostCancelCopy.states[state],
    impact: impactView(data.impact),
  };
}

/** The host's cancel form: the session, the impact that was read, and the box ticked to say so. Nothing is repaired. */
export function parseHostCancelForm(
  get: FormGetter,
): FormResult<ImpactFormInput> {
  const parsed = parseImpactForm(get);
  return parsed === null ? { ok: false } : { ok: true, value: parsed };
}

/** What an attempt can end in: what `cancelSession` or the refusals before it say, or a form refused before anything was read. */
export const hostCancelNoticeCodes = [
  'cancelled',
  'cancelled_payments_left',
  'already_cancelled',
  'completed',
  'not_found',
  'blocked',
  'stale',
  'in_the_past',
  'invalid',
] as const satisfies readonly (CancelNoticeCode | 'invalid')[];
export type HostCancelNoticeCode = (typeof hostCancelNoticeCodes)[number];

/** The notice an attempt ends in. */
export function hostCancelOutcomeCode(
  outcome: OpsCancelOutcome | 'invalid',
): HostCancelNoticeCode {
  return outcome === 'invalid' ? outcome : cancelOutcomeNotice(outcome);
}

/** The notice the address names, or null for none, an unknown one, or a repeated one. */
export function hostCancelNotice(
  raw: string | readonly string[] | undefined,
): NoticeText | null {
  const code = parseNotice(raw, hostCancelNoticeCodes);
  return code === null ? null : hostCancelNotices[code];
}
