import type { ExperienceStatus } from './experienceEditor';
import { noticeText, parseNotice, type NoticeText } from './opsForm';
import { countLabel } from './text';

// Pausing an experience takes it off every guest page without losing it; unpausing puts it back
// in the status it was paused from. Ops pauses one experience, or suspends a host, which pauses
// every experience of the host that guests can see. A host has no status of its own: it is
// suspended from its latest suspend row in the audit log until its latest unsuspend row. While it
// is suspended nothing of its goes public: an approval and an unpause are refused. The audit log
// holds codes and never a sentence, so neither action takes a reason.

export type PauseKind = 'pause' | 'unpause';

/**
 * The statuses a pause takes down: every one guests can see (`guestVisibleStatuses`, which a test
 * pins this to). A suspension, the pause guard and the host page counts all use this one list.
 */
export const pausableStatuses = [
  'live',
  'guide_only',
] as const satisfies readonly ExperienceStatus[];
export type PausableStatus = (typeof pausableStatuses)[number];

const isPausable = (status: ExperienceStatus): status is PausableStatus =>
  (pausableStatuses as readonly string[]).includes(status);

/** The one status a paused experience is in. */
export const pausedStatus = 'paused' as const satisfies ExperienceStatus;

/** The action the experience page offers for a status: pause what guests can see, unpause what is paused, nothing otherwise. */
export function pauseActionFor(status: ExperienceStatus): PauseKind | null {
  if (isPausable(status)) return 'pause';
  return status === pausedStatus ? 'unpause' : null;
}

/**
 * The status an unpause restores: the one the latest pause recorded, or live when there is none to
 * read. A guide entry needs its link out (a database rule), so one whose link was removed while
 * it was paused comes back live rather than as a guide entry the database would refuse.
 */
export function restoredStatus(
  pausedFrom: string | null,
  hasLinkOut: boolean,
): PausableStatus {
  const recorded = pausableStatuses.find((status) => status === pausedFrom);
  return recorded === 'guide_only' && !hasLinkOut
    ? 'live'
    : (recorded ?? 'live');
}

/** The statuses an experience is moved from and to by a pause, or by an unpause back to `restored` (live when none is known). */
export function movedStatus(
  kind: PauseKind,
  status: ExperienceStatus,
  restored: PausableStatus | null,
): { from: ExperienceStatus; to: ExperienceStatus } {
  return kind === 'pause'
    ? { from: status, to: pausedStatus }
    : { from: pausedStatus, to: restored ?? 'live' };
}

/** Whether a host's latest suspend or unsuspend audit action leaves it suspended. */
export function leavesSuspended(latestAction: string | undefined): boolean {
  return latestAction === 'host.suspended';
}

export type PauseRefusal = {
  status: 'not_live' | 'not_paused' | 'unpause_host_suspended';
};

/**
 * Why an action cannot go ahead, or null when it can: only an experience guests can see is
 * paused and only a paused one is unpaused, and nothing is unpaused while its host is suspended.
 */
export function pauseRefusal(
  status: ExperienceStatus,
  kind: PauseKind,
  hostSuspended: boolean,
): PauseRefusal | null {
  if (pauseActionFor(status) !== kind) {
    return { status: kind === 'pause' ? 'not_live' : 'not_paused' };
  }
  return kind === 'unpause' && hostSuspended
    ? { status: 'unpause_host_suspended' }
    : null;
}

/** What the experience page says an action does. */
export function pauseExplainerText(kind: PauseKind): string {
  return kind === 'pause'
    ? 'Pausing hides this experience from guests and stops new bookings. Existing bookings stay.'
    : 'Guests cannot see or book this experience. Unpausing puts it back as it was.';
}

/** The label of an action's button. */
export function pauseActionLabel(kind: PauseKind): string {
  return kind === 'pause' ? 'Pause experience' : 'Unpause experience';
}

const pauseNoticeCodes = [
  'paused',
  'unpaused',
  'not_live',
  'not_paused',
  'unpause_host_suspended',
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
  unpaused: {
    tone: 'success',
    title: 'Experience unpaused. It is restored as it was.',
  },
  not_live: {
    tone: 'info',
    title:
      'That experience is not live or a guide entry, so it was not paused.',
  },
  not_paused: {
    tone: 'info',
    title: 'That experience is not paused, so nothing changed.',
  },
  unpause_host_suspended: {
    tone: 'danger',
    title:
      'Unpausing refused. This host is suspended. Unsuspend the host first.',
  },
  suspended: {
    tone: 'success',
    title: 'Host suspended. Every experience guests could see is paused.',
  },
  unsuspended: {
    tone: 'success',
    title:
      'Host unsuspended. The experiences the suspension paused are restored.',
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

/** The label of the button that suspends or unsuspends a host. */
export function suspensionActionLabel(kind: PauseKind): string {
  return kind === 'pause' ? 'Suspend host' : 'Unsuspend host';
}

/** What a suspended host's section says first. */
export const hostSuspendedText = 'This host is suspended.';

/** What suspending the host does, by how many experiences are live. */
export function suspensionLiveText(liveCount: number): string {
  if (liveCount === 0) {
    return 'Guests can see none of this host experiences. Suspending it records the suspension, so nothing of its can go public until it is lifted.';
  }
  return `Suspending pauses ${countLabel(liveCount, 'experience')} that guests can see. Guests stop seeing and booking ${liveCount === 1 ? 'it' : 'them'}, and nothing of the host's can go public until the suspension is lifted. Existing bookings stay.`;
}

/** What unsuspending the host does, by how many experiences the suspension paused. */
export function suspensionUndoText(suspendedCount: number): string {
  if (suspendedCount === 0) {
    return 'The suspension paused nothing that is still paused. Unsuspending lifts it. Anything paused by hand stays paused.';
  }
  return `Unsuspending restores the ${countLabel(suspendedCount, 'experience')} this suspension paused. Anything paused by hand stays paused.`;
}
