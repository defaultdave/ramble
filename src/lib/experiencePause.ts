import type { ExperienceStatus } from './experienceEditor';
import { noticeText, type NoticeText } from './opsForm';

// Pausing an experience takes it off every guest page without losing it; unpausing puts it back.
// Ops pauses one experience, or suspends a host, which pauses every live experience the host has.
// The audit log holds codes and never a sentence, so neither action takes a reason.

export type PauseKind = 'pause' | 'unpause';

/** Where an experience goes on each action, and the one status it can be in to take it. */
export const pauseTransitions = {
  pause: { from: 'live', to: 'paused' },
  unpause: { from: 'paused', to: 'live' },
} as const satisfies Record<
  PauseKind,
  { from: ExperienceStatus; to: ExperienceStatus }
>;

export type PauseRefusal = { status: 'not_live' | 'not_paused' };

/** Why an action cannot go ahead, or null when it can: only a live experience is paused and only a paused one is unpaused. */
export function pauseRefusal(
  status: ExperienceStatus,
  kind: PauseKind,
): PauseRefusal | null {
  if (status === pauseTransitions[kind].from) return null;
  return { status: kind === 'pause' ? 'not_live' : 'not_paused' };
}

export const pauseNoticeCodes = [
  'paused',
  'unpaused',
  'not_live',
  'not_paused',
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
    title: 'This host has no live experiences, so nothing changed.',
  },
  nothing_to_unsuspend: {
    tone: 'info',
    title:
      'The suspension paused nothing that is still paused, so nothing changed.',
  },
} as const satisfies Record<PauseNoticeCode, NoticeText>;

/** The notice for a code, or null for none. */
export const pauseNoticeFor = (code: PauseNoticeCode | null) =>
  noticeText(pauseNotices, code);

/** What a host's suspension holds: the live experiences it would pause and the paused ones it paused. */
export type HostSuspension = { liveCount: number; suspendedCount: number };
