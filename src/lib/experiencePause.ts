import type { ExperienceStatus } from './experienceEditor';
import { noticeText, parseNotice, type NoticeText } from './opsForm';
import { countLabel } from './text';

// Pausing an experience takes it off every guest page without losing it; unpausing puts it back.
// Ops pauses one experience, or suspends a host, which pauses every live experience the host has.
// A host has no status of its own: it is suspended from its latest suspend row in the audit log
// until its latest unsuspend row. While it is suspended nothing of its goes live: an approval and
// an unpause are refused. The audit log holds codes and never a sentence, so neither action takes
// a reason.

export type PauseKind = 'pause' | 'unpause';

/** Where an experience goes on each action, and the one status it can be in to take it. */
export const pauseTransitions = {
  pause: { from: 'live', to: 'paused' },
  unpause: { from: 'paused', to: 'live' },
} as const satisfies Record<
  PauseKind,
  { from: ExperienceStatus; to: ExperienceStatus }
>;

export type PauseRefusal = {
  status: 'not_live' | 'not_paused' | 'host_suspended';
};

/**
 * Why an action cannot go ahead, or null when it can: only a live experience is paused and only a
 * paused one is unpaused, and nothing is unpaused while its host is suspended.
 */
export function pauseRefusal(
  status: ExperienceStatus,
  kind: PauseKind,
  hostSuspended: boolean,
): PauseRefusal | null {
  if (status !== pauseTransitions[kind].from) {
    return { status: kind === 'pause' ? 'not_live' : 'not_paused' };
  }
  return kind === 'unpause' && hostSuspended
    ? { status: 'host_suspended' }
    : null;
}

export const pauseNoticeCodes = [
  'paused',
  'unpaused',
  'not_live',
  'not_paused',
  'host_suspended',
  'suspended',
  'unsuspended',
  'nothing_to_suspend',
  'nothing_to_unsuspend',
] as const;
export type PauseNoticeCode = (typeof pauseNoticeCodes)[number];

const pauseNotices = {
  paused: {
    tone: 'success',
    title: 'Experience paused. Guests can no longer see or book it.',
  },
  unpaused: { tone: 'success', title: 'Experience unpaused. It is live.' },
  not_live: {
    tone: 'info',
    title: 'That experience is not live, so it was not paused.',
  },
  not_paused: {
    tone: 'info',
    title: 'That experience is not paused, so nothing changed.',
  },
  host_suspended: {
    tone: 'danger',
    title:
      'Unpausing refused. This host is suspended. Unsuspend the host first.',
  },
  suspended: {
    tone: 'success',
    title: 'Host suspended. Its live experiences are paused.',
  },
  unsuspended: {
    tone: 'success',
    title: 'Host unsuspended. The experiences the suspension paused are live.',
  },
  nothing_to_suspend: {
    tone: 'info',
    title: 'This host is already suspended, so nothing changed.',
  },
  nothing_to_unsuspend: {
    tone: 'info',
    title: 'This host is not suspended, so nothing changed.',
  },
} as const satisfies Record<PauseNoticeCode, NoticeText>;

/** The notice a page address names among the pause notices, or null for none or an unknown one. */
export function pauseNoticeOf(
  raw: string | readonly string[] | undefined,
): NoticeText | null {
  return noticeText(pauseNotices, parseNotice(raw, pauseNoticeCodes));
}

/** The notice for a code, or null for none. */
export const pauseNoticeFor = (code: PauseNoticeCode | null) =>
  noticeText(pauseNotices, code);

/** What a pause or unpause of one experience reports. */
export const experienceOutcome = (kind: PauseKind) =>
  kind === 'pause' ? 'paused' : 'unpaused';

/**
 * Whether suspending or unsuspending a host changes anything: it does when it moves an
 * experience, and when it changes whether the host is suspended, even with no experience to move,
 * because a suspended host's later approval is refused.
 */
export function hostChanges(
  kind: PauseKind,
  movedCount: number,
  suspended: boolean,
): boolean {
  return movedCount > 0 || suspended !== (kind === 'pause');
}

/** What suspending or unsuspending a host reports. */
export function hostOutcome(kind: PauseKind, changed: boolean) {
  if (kind === 'pause') return changed ? 'suspended' : 'nothing_to_suspend';
  return changed ? 'unsuspended' : 'nothing_to_unsuspend';
}

/** What a host's suspension shows ops: whether it is suspended, the live experiences it would pause and the paused ones it paused. */
export type HostSuspension = {
  suspended: boolean;
  liveCount: number;
  suspendedCount: number;
};

/** What a host that cannot be read shows: nothing. */
export const noSuspension: HostSuspension = {
  suspended: false,
  liveCount: 0,
  suspendedCount: 0,
};

/** What suspending the host does, by how many experiences are live. */
export function suspensionLiveText(liveCount: number): string {
  if (liveCount === 0) {
    return 'This host has no live experiences. Suspending it records the suspension, so nothing of its can go live until it is lifted.';
  }
  const verb = liveCount === 1 ? 'is' : 'are';
  return `Suspending pauses ${countLabel(liveCount, 'experience')} that ${verb} live. Guests stop seeing and booking them, and nothing of the host's can go live until the suspension is lifted. Existing bookings stay.`;
}

/** What unsuspending the host does, by how many experiences the suspension paused. */
export function suspensionUndoText(suspendedCount: number): string {
  if (suspendedCount === 0) {
    return 'The suspension paused nothing that is still paused. Unsuspending lifts it. Anything paused by hand stays paused.';
  }
  return `Unsuspending makes the ${countLabel(suspendedCount, 'experience')} paused by the suspension live again. Anything paused by hand stays paused.`;
}
