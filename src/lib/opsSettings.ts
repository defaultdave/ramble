import { cancellationTerms } from './cancellation';
import type { CancellationTier } from './catalog';
import { experiencePath, experiencesPath } from './experienceEditor';
import { pausedStatus } from './experiencePause';
import {
  changedFields,
  fieldsFromIssues,
  formHas,
  formText,
  formWholeNumber,
  invalidFormNotice,
  noticeHref,
  oversizedFields,
  rawFormFieldLimit,
  type FormGetter,
  type NoticeText,
} from './opsForm';
import {
  SettingsSchema,
  settingKeys,
  type SettingKey,
  type Settings,
  type SettingsChange,
} from './settings';
import { tableHref } from './tableQuery';

// The ops settings page: the switches and numbers ops sets, read from a posted form. The gift
// settings are not on the page, so the form never sets them. Tax is typed as a percent and stored
// as parts per million (design doc 4.2.3).

export const settingsPath = '/ops/settings';

/** Ppm of a whole percent: the tax rate is stored as ppm of the ticket subtotal. */
const ppmPerPercent = 10_000;
const percentDecimals = 4;

// Up to two whole digits and up to four decimals, the finest a ppm can say. No repeated group, so it is linear.
const percentPattern = /^(\d{1,2})(?:\.(\d{1,4}))?$/;

/** The ppm a typed percent stands for ("8.875" is 88750), or undefined when it is not a percent of that shape. Integer arithmetic, so no rate drifts. */
export function percentToPpm(text: string | undefined): number | undefined {
  const match = text === undefined ? null : percentPattern.exec(text);
  if (match === null) return undefined;
  const [, whole = '0', fraction = ''] = match;
  return (
    Number(whole) * ppmPerPercent +
    Number(fraction.padEnd(percentDecimals, '0'))
  );
}

/** A stored rate as the percent ops types it: "8.875", and "25" with no trailing zeros. */
export function ppmToPercent(ppm: number): string {
  const whole = Math.floor(ppm / ppmPerPercent);
  const fraction = String(ppm % ppmPerPercent)
    .padStart(percentDecimals, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${String(whole)}.${fraction}`;
}

/** The fields a save can refuse, in the order the form shows them. The two switches cannot be refused: a box is ticked or it is not. */
export const settingsFormFields = [
  'bannerText',
  'holdMinutes',
  'paymentGraceMinutes',
  'taxRatePercent',
] as const;
export type SettingsFormField = (typeof settingsFormFields)[number];

const EditedSettingsSchema = SettingsSchema.pick({
  bannerText: true,
  bookingsPaused: true,
  holdMinutes: true,
  paymentGraceMinutes: true,
  checkoutMaintenance: true,
  taxRatePpm: true,
});

export const settingsFieldProblems = {
  bannerText: 'Use up to 280 characters, or leave it blank for no banner.',
  holdMinutes: 'Enter a whole number of minutes, from 1 to 60.',
  paymentGraceMinutes: 'Enter a whole number of minutes, from 0 to 30.',
  taxRatePercent:
    'Enter a percent from 0 to 25 with up to four decimals, like 8.875.',
} as const satisfies Record<SettingsFormField, string>;

export type SettingsFormResult =
  | { ok: true; value: SettingsChange }
  | { ok: false; fields: SettingsFormField[] };

/**
 * The posted form as a change: the six settings the page shows, each read once. A box left
 * unticked is off. Nothing is repaired: a number that is not a number, or is out of range, names
 * its field and changes nothing. A blank banner is no banner.
 */
export function parseSettingsForm(get: FormGetter): SettingsFormResult {
  const oversized = oversizedFields(get, settingsFormFields, rawFormFieldLimit);
  if (oversized.length > 0) return { ok: false, fields: oversized };
  const parsed = EditedSettingsSchema.safeParse({
    bannerText: formText(get, 'bannerText') ?? null,
    bookingsPaused: formHas(get, 'bookingsPaused'),
    holdMinutes: formWholeNumber(get, 'holdMinutes'),
    paymentGraceMinutes: formWholeNumber(get, 'paymentGraceMinutes'),
    checkoutMaintenance: formHas(get, 'checkoutMaintenance'),
    taxRatePpm: percentToPpm(formText(get, 'taxRatePercent')),
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    fields: fieldsFromIssues(
      parsed.error.issues,
      settingsFormFields,
      ([key]) => (key === 'taxRatePpm' ? 'taxRatePercent' : key),
    ),
  };
}

/** The settings a save would change, in table order: those the change names whose value differs from the stored one. A named setting with the stored value is no change. */
export function changedSettingKeys(
  current: Pick<Settings, SettingKey>,
  change: SettingsChange,
): SettingKey[] {
  const named = Object.fromEntries(
    Object.entries(change).filter(([, value]) => value !== undefined),
  );
  return changedFields(settingKeys, current, { ...current, ...named });
}

/** What the form shows for the stored settings: text for the fields, flags for the boxes. */
export function settingsFormValues(settings: Settings) {
  return {
    bannerText: settings.bannerText ?? '',
    bookingsPaused: settings.bookingsPaused,
    holdMinutes: String(settings.holdMinutes),
    paymentGraceMinutes: String(settings.paymentGraceMinutes),
    checkoutMaintenance: settings.checkoutMaintenance,
    taxRatePercent: ppmToPercent(settings.taxRatePpm),
  };
}
export type SettingsFormValues = ReturnType<typeof settingsFormValues>;

export type SettingsSaveOutcome = 'saved' | 'unchanged';

/** A save that changed nothing is `unchanged`: no audit row and no cache clearing went with it. */
export function settingsSaveOutcome(
  changed: readonly SettingKey[],
): SettingsSaveOutcome {
  return changed.length === 0 ? 'unchanged' : 'saved';
}

export const settingsNoticeCodes = ['saved', 'unchanged', 'invalid'] as const;
export type SettingsNoticeCode = (typeof settingsNoticeCodes)[number];

export const settingsNotices = {
  saved: { tone: 'success', title: 'Settings saved.' },
  unchanged: {
    tone: 'info',
    title: 'Nothing was different, so nothing changed.',
  },
  invalid: invalidFormNotice,
} as const satisfies Record<SettingsNoticeCode, NoticeText>;

/** Where a save ends: a refused form back with the fields to look at, a save back with its notice. */
export function settingsSaveNext(
  outcome:
    | { status: 'invalid'; fields: readonly SettingsFormField[] }
    | { status: SettingsSaveOutcome },
): string {
  return outcome.status === 'invalid'
    ? noticeHref(settingsPath, 'invalid', outcome.fields)
    : noticeHref(settingsPath, outcome.status);
}

/** A tier as the read-only list shows it: its name and what it promises, in the words the experience page uses. */
export function cancellationTierRows(tiers: readonly CancellationTier[]) {
  return tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    terms: cancellationTerms(tier).fact,
    isDefault: tier.isDefault,
  }));
}
export type CancellationTierRow = ReturnType<
  typeof cancellationTierRows
>[number];

/** The paused experiences as the page lists them, each with the link to its ops page, and the link to the full list when this page is only the first. */
export function pausedExperienceSummary(page: {
  rows: readonly { id: string; name: string; hostName: string }[];
  nextCursor: string | null;
}) {
  return {
    rows: page.rows.map((row) => ({
      id: row.id,
      name: row.name,
      hostName: row.hostName,
      href: experiencePath(row.id),
    })),
    moreHref:
      page.nextCursor === null
        ? null
        : tableHref(experiencesPath, { status: pausedStatus }),
  };
}
export type PausedExperienceSummary = ReturnType<
  typeof pausedExperienceSummary
>;
