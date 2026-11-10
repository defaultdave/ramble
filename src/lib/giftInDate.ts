import { settingsBounds } from './settings';

/** Gift limits the database CHECKs repeat. */
export const giftLimits = {
  recipientName: 120,
  message: 300,
  /** A gift is sent at most this many days after it is bought (design doc 4.2.3, Gifts). */
  sendHorizonDays: 365,
} as const;

const dayMs = 86_400_000;

/**
 * The one in-date check for a gift: the moment `at` is before `valid_until`. A gift is out of date
 * at `valid_until` itself. Redemption and the redemption page both call it, so they never disagree.
 */
export function giftInDate(gift: { validUntil: Date }, at: Date): boolean {
  return at.getTime() < gift.validUntil.getTime();
}

/** Whether `sendAt` is no later than the horizon after `now`. */
export function giftSendAtWithinHorizon(sendAt: Date, now: Date): boolean {
  return sendAt.getTime() <= now.getTime() + giftLimits.sendHorizonDays * dayMs;
}

/**
 * `send_at` plus `validityMonths` calendar months in UTC, clamped to the last day of a shorter
 * month (31 January plus one month is the last day of February). The months are the settings value.
 */
export function giftValidUntil(sendAt: Date, validityMonths: number): Date {
  const { min, max } = settingsBounds.giftValidityMonths;
  if (
    !Number.isInteger(validityMonths) ||
    validityMonths < min ||
    validityMonths > max
  ) {
    throw new RangeError(
      `Gift validity is a whole number of months from ${String(min)} to ${String(max)}, got ${String(validityMonths)}`,
    );
  }
  if (Number.isNaN(sendAt.getTime())) {
    throw new RangeError('A gift is sent at a valid time');
  }
  const monthIndex = sendAt.getUTCMonth() + validityMonths;
  const year = sendAt.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const result = new Date(sendAt.getTime());
  result.setUTCFullYear(year, month, Math.min(sendAt.getUTCDate(), lastDay));
  return result;
}
