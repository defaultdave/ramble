import { z } from 'zod';
import { optionalText } from './text';

export const giftExpiryActions = ['refund_buyer', 'leave_open'] as const;

/** Bounds for the numeric settings. The database CHECKs on `settings` use the same numbers. */
export const settingsBounds = {
  holdMinutes: { min: 1, max: 60 },
  paymentGraceMinutes: { min: 0, max: 30 },
  giftValidityMonths: { min: 1, max: 120 },
  /** 25 percent. The rate is parts per million of the ticket subtotal (design doc 4.2.3), so 8.875 percent is 88750. */
  taxRatePpm: { min: 0, max: 250_000 },
  bannerChars: 280,
} as const;

const bannerText = optionalText(settingsBounds.bannerChars);

function intBetween({ min, max }: { min: number; max: number }) {
  return z.int().min(min).max(max);
}

const settingFields = {
  bannerText,
  bookingsPaused: z.boolean(),
  giftsEnabled: z.boolean(),
  checkoutMaintenance: z.boolean(),
  holdMinutes: intBetween(settingsBounds.holdMinutes),
  paymentGraceMinutes: intBetween(settingsBounds.paymentGraceMinutes),
  giftValidityMonths: intBetween(settingsBounds.giftValidityMonths),
  giftExpiryAction: z.enum(giftExpiryActions),
  taxRatePpm: intBetween(settingsBounds.taxRatePpm),
};

export const SettingsSchema = z.object({
  ...settingFields,
  updatedAt: z.date(),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** What a guest page may know: the banner and the switches, never a rate or a window. */
export const GuestSettingsSchema = SettingsSchema.pick({
  bannerText: true,
  bookingsPaused: true,
  giftsEnabled: true,
  checkoutMaintenance: true,
});
export type GuestSettings = z.infer<typeof GuestSettingsSchema>;

/** What the hold path reads inside its transaction: the pause switch, the hold length, and the tax rate. */
export const HoldSettingsSchema = SettingsSchema.pick({
  bookingsPaused: true,
  holdMinutes: true,
  taxRatePpm: true,
});
export type HoldSettings = z.infer<typeof HoldSettingsSchema>;

/** A change names only the settings it sets, and sets at least one. */
export const SettingsChangeSchema = z
  .strictObject(settingFields)
  .partial()
  .refine(
    (change) => Object.values(change).some((value) => value !== undefined),
    { message: 'A change sets at least one setting' },
  );
export type SettingsChange = z.infer<typeof SettingsChangeSchema>;
