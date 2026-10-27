import { describe, expect, it } from 'vitest';
import {
  GuestSettingsSchema,
  SettingsChangeSchema,
  SettingsSchema,
  settingsBounds,
} from './settings';

// Behaviours under test, one per decision, branch or risk:
// - each numeric setting accepts its lowest and highest value and refuses the step beyond each
// - a banner is null, or 1 to 280 characters that are not all blank
// - a change names only settings it sets, sets at least one, and refuses unknown names
// - a guest sees the banner and the switches and nothing else, even from a full row

const fullSettings = {
  bannerText: 'Rain today: some tours may move',
  bookingsPaused: false,
  giftsEnabled: true,
  checkoutMaintenance: false,
  holdMinutes: 10,
  paymentGraceMinutes: 5,
  giftValidityMonths: 12,
  giftExpiryAction: 'refund_buyer',
  taxRatePpm: 88_750,
  updatedAt: new Date('2026-10-26T12:00:00Z'),
} as const;

const numeric = [
  ['holdMinutes', settingsBounds.holdMinutes],
  ['paymentGraceMinutes', settingsBounds.paymentGraceMinutes],
  ['giftValidityMonths', settingsBounds.giftValidityMonths],
  ['taxRatePpm', settingsBounds.taxRatePpm],
] as const;

describe('numeric settings', () => {
  it.each(numeric)(
    '%s accepts its bounds and refuses the step beyond each',
    (key, bounds) => {
      const accepts = (value: number) =>
        SettingsChangeSchema.safeParse({ [key]: value }).success;

      expect(accepts(bounds.min)).toBe(true);
      expect(accepts(bounds.max)).toBe(true);
      expect(accepts(bounds.min - 1)).toBe(false);
      expect(accepts(bounds.max + 1)).toBe(false);
    },
  );

  it.each(numeric)('%s refuses a fraction and a string', (key) => {
    expect(SettingsChangeSchema.safeParse({ [key]: 5.5 }).success).toBe(false);
    expect(SettingsChangeSchema.safeParse({ [key]: '5' }).success).toBe(false);
  });

  it('holds the configured tax rate as parts per million', () => {
    expect(SettingsSchema.parse(fullSettings).taxRatePpm).toBe(88_750);
  });
});

describe('the banner', () => {
  it.each([
    ['null, which turns it off', null, true],
    ['one character', 'x', true],
    ['the longest banner', 'x'.repeat(settingsBounds.bannerChars), true],
    ['one over the longest', 'x'.repeat(settingsBounds.bannerChars + 1), false],
    ['empty', '', false],
    ['only spaces', '  \t', false],
    ['280 emoji', '😀'.repeat(settingsBounds.bannerChars), true],
    ['281 emoji', '😀'.repeat(settingsBounds.bannerChars + 1), false],
  ])('%s is accepted: %s', (_name, bannerText, accepted) => {
    expect(SettingsChangeSchema.safeParse({ bannerText }).success).toBe(
      accepted,
    );
  });
});

describe('a change', () => {
  it('may set the switches and the gift expiry action', () => {
    expect(
      SettingsChangeSchema.parse({
        bookingsPaused: true,
        giftsEnabled: false,
        checkoutMaintenance: true,
        giftExpiryAction: 'leave_open',
      }),
    ).toEqual({
      bookingsPaused: true,
      giftsEnabled: false,
      checkoutMaintenance: true,
      giftExpiryAction: 'leave_open',
    });
  });

  it.each([
    ['nothing at all', {}],
    ['only undefined values', { holdMinutes: undefined }],
    ['a setting it does not know', { holdMinutes: 10, hostPayoutDay: 3 }],
    ['an expiry action it does not know', { giftExpiryAction: 'forfeit' }],
    ['the update time', { updatedAt: new Date('2026-10-26T12:00:00Z') }],
  ])('refuses %s', (_name, change) => {
    expect(SettingsChangeSchema.safeParse(change).success).toBe(false);
  });
});

describe('what a guest sees', () => {
  it('is the banner and the switches, with the rest stripped from a full row', () => {
    expect(GuestSettingsSchema.parse(fullSettings)).toEqual({
      bannerText: 'Rain today: some tours may move',
      bookingsPaused: false,
      giftsEnabled: true,
      checkoutMaintenance: false,
    });
  });
});
