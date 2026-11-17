import { userActor, type AuditEntryInput } from './audit';
import { opsAreaIds } from './opsAudit';
import type { SettingKey, Settings } from './settings';

// The audit row of a settings save. An ops or admin user does it, so the actor is a named user.
// The log holds ids, flags and amounts, never a sentence, so a changed banner is flagged and its
// text is not written.

type SettingValues = Pick<Settings, SettingKey>;

const detailNames = {
  bannerText: 'banner_text',
  bookingsPaused: 'bookings_paused',
  giftsEnabled: 'gifts_enabled',
  checkoutMaintenance: 'checkout_maintenance',
  holdMinutes: 'hold_minutes',
  paymentGraceMinutes: 'payment_grace_minutes',
  giftValidityMonths: 'gift_validity_months',
  giftExpiryAction: 'gift_expiry_action',
  taxRatePpm: 'tax_rate_ppm',
} as const satisfies Record<SettingKey, string>;

type Details = Record<string, string | number | boolean | null>;

function detailsFor(
  key: SettingKey,
  before: SettingValues,
  after: SettingValues,
): Details {
  const name = detailNames[key];
  if (key === 'bannerText') return { banner_text_changed: true };
  const [from, to] = [before[key], after[key]];
  // A two-valued setting records the new value alone: the old one is the other. That keeps a save of every setting inside the log's 16 keys.
  return typeof from === 'number'
    ? { [`${name}_from`]: from, [`${name}_to`]: to }
    : { [name]: to };
}

/** Settings saved: each changed setting with its old and new value, the banner only flagged. */
export function settingsChangedEntry(
  userId: string,
  before: SettingValues,
  after: SettingValues,
  changed: readonly SettingKey[],
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'settings.changed',
    subjectKind: 'settings',
    subjectId: opsAreaIds.settings,
    details: Object.assign(
      {},
      ...changed.map((key) => detailsFor(key, before, after)),
    ) as Details,
  };
}
