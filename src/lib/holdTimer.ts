export type HoldTimerState = 'running' | 'warning' | 'expired';

const WARNING_UNDER_SECONDS = 120;
const ANNOUNCE_FIVE_MINUTES_AT = 300;
const ANNOUNCE_TWO_MINUTES_AT = 120;

export function holdTimerState(secondsRemaining: number): HoldTimerState {
  if (secondsRemaining <= 0) return 'expired';
  return secondsRemaining < WARNING_UNDER_SECONDS ? 'warning' : 'running';
}

// "9:42". Minutes are not capped at 59, since a hold is never an hour long.
export function formatHoldTime(secondsRemaining: number): string {
  const whole = Math.max(0, Math.floor(secondsRemaining));
  const seconds = String(whole % 60).padStart(2, '0');
  return `${String(Math.floor(whole / 60))}:${seconds}`;
}

export function holdTimerText(secondsRemaining: number): string {
  return holdTimerState(secondsRemaining) === 'expired'
    ? 'Hold expired'
    : `Spaces held for ${formatHoldTime(secondsRemaining)}`;
}

// A live region speaks only when its text changes, so the text changes only at
// 5 minutes, 2 minutes, and expiry; a countdown read every second is noise.
export function holdAnnouncement(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return 'Your hold has expired.';
  if (secondsRemaining <= ANNOUNCE_TWO_MINUTES_AT) {
    return 'Your hold ends in 2 minutes.';
  }
  if (secondsRemaining <= ANNOUNCE_FIVE_MINUTES_AT) {
    return 'Your hold ends in 5 minutes.';
  }
  return '';
}
