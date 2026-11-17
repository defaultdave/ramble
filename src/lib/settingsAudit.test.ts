import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import { opsAreaIds } from './opsAudit';
import { settingsChangedEntry } from './settingsAudit';
import { settingKeys, type Settings } from './settings';

// Behaviours under test:
// - the row names the user, the settings area, and passes the audit log's own validation
// - a number records its old and new value; a switch or the gift action records the new value
// - a banner change is flagged and its text never appears
// - a save that changes every setting still fits the log's 16 keys

const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const before: Settings = {
  bannerText: 'Old banner words',
  bookingsPaused: false,
  giftsEnabled: true,
  checkoutMaintenance: false,
  holdMinutes: 10,
  paymentGraceMinutes: 5,
  giftValidityMonths: 12,
  giftExpiryAction: 'refund_buyer',
  taxRatePpm: 88_750,
  updatedAt: new Date('2026-11-01T00:00:00Z'),
};

describe('settingsChangedEntry', () => {
  it('records the user, the action and the settings area', () => {
    const entry = settingsChangedEntry(userId, before, before, ['holdMinutes']);
    expect(entry).toMatchObject({
      actorKind: 'user',
      actorId: userId,
      action: 'settings.changed',
      subjectKind: 'settings',
      subjectId: opsAreaIds.settings,
    });
    expect(() => parseAuditEntry(entry)).not.toThrow();
  });

  it('records old and new for a number, and the new value for a switch', () => {
    const after = {
      ...before,
      holdMinutes: 15,
      taxRatePpm: 0,
      bookingsPaused: true,
      giftExpiryAction: 'leave_open' as const,
    };
    const entry = settingsChangedEntry(userId, before, after, [
      'bookingsPaused',
      'holdMinutes',
      'giftExpiryAction',
      'taxRatePpm',
    ]);
    expect(entry.details).toEqual({
      bookings_paused: true,
      hold_minutes_from: 10,
      hold_minutes_to: 15,
      gift_expiry_action: 'leave_open',
      tax_rate_ppm_from: 88_750,
      tax_rate_ppm_to: 0,
    });
  });

  it('flags a banner change and never writes its text', () => {
    const entry = settingsChangedEntry(
      userId,
      before,
      { ...before, bannerText: 'New banner words' },
      ['bannerText'],
    );
    expect(entry.details).toEqual({ banner_text_changed: true });
    expect(JSON.stringify(entry)).not.toContain('banner words');
  });

  it('fits the log when every setting changes at once', () => {
    const after: Settings = {
      bannerText: null,
      bookingsPaused: true,
      giftsEnabled: false,
      checkoutMaintenance: true,
      holdMinutes: 20,
      paymentGraceMinutes: 6,
      giftValidityMonths: 24,
      giftExpiryAction: 'leave_open',
      taxRatePpm: 1,
      updatedAt: before.updatedAt,
    };
    const entry = settingsChangedEntry(userId, before, after, settingKeys);
    expect(() => parseAuditEntry(entry)).not.toThrow();
  });
});
