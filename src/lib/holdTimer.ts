export type HoldTimerState = 'running' | 'warning' | 'expired';

const WARNING_UNDER_SECONDS = 120;
const ANNOUNCE_FIVE_MINUTES_AT = 300;
const ANNOUNCE_TWO_MINUTES_AT = 120;

// Whole seconds left, rounded up so a hold with any time left never reads 0:00.
// A date that is not a real time counts as expired: the guest must not be told they still hold spaces.
// TODO(U-047b): first caller, the checkout hold countdown hook.
export function holdSecondsRemaining(now: Date, expiresAt: Date): number {
  const seconds = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

export function holdTimerState(now: Date, expiresAt: Date): HoldTimerState {
  const seconds = holdSecondsRemaining(now, expiresAt);
  if (seconds === 0) return 'expired';
  return seconds < WARNING_UNDER_SECONDS ? 'warning' : 'running';
}

// "9:42". Minutes are not capped at 59, since a hold is never an hour long.
function formatHoldTime(seconds: number): string {
  const rest = String(seconds % 60).padStart(2, '0');
  return `${String(Math.floor(seconds / 60))}:${rest}`;
}

export function holdTimerText(now: Date, expiresAt: Date): string {
  const seconds = holdSecondsRemaining(now, expiresAt);
  return seconds === 0
    ? 'Hold expired'
    : `Spaces held for ${formatHoldTime(seconds)}`;
}

// A live region speaks only when its text changes, so the text changes only at
// 5 minutes, 2 minutes, and expiry; a countdown read every second is noise.
export function holdAnnouncement(now: Date, expiresAt: Date): string {
  const seconds = holdSecondsRemaining(now, expiresAt);
  if (seconds === 0) return 'Your hold has expired.';
  if (seconds <= ANNOUNCE_TWO_MINUTES_AT) return 'Your hold ends in 2 minutes.';
  if (seconds <= ANNOUNCE_FIVE_MINUTES_AT)
    return 'Your hold ends in 5 minutes.';
  return '';
}
