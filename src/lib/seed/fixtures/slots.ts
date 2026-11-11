import type { SlotFixture } from '../types';

/** A weekly slot in one line: weekday (0 is Sunday), start time, length in minutes, and spaces. */
export function slot(
  weekday: number,
  startTime: string,
  durationMinutes: number,
  allocation: number,
  leaves?: SlotFixture['leaves'],
): SlotFixture {
  return {
    weekday,
    startTime,
    durationMinutes,
    allocation,
    ...(leaves ? { leaves } : {}),
  };
}
