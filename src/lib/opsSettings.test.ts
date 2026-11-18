import { describe, expect, it } from 'vitest';
import {
  cancellationTierRows,
  changedSettingKeys,
  parseSettingsForm,
  asStaleSettings,
  parseSettingsVersion,
  StaleSettingsError,
  settingsSaveStatus,
  pausedExperienceSummary,
  percentToPpm,
  ppmToPercent,
  settingsFormValues,
  settingsSaveNext,
  settingsNotices,
  settingsSaveOutcome,
  settingsVersionIsCurrent,
  type SettingsRead,
  type SettingsFormField,
} from './opsSettings';
import { settingsBounds } from './settings';

// Behaviours under test, one per decision, branch or risk:
// - a typed percent becomes ppm by integer arithmetic ("8.875" is 88750) and a stored rate shows back as the same text
// - text that is not a percent of that shape (sign, comma, five decimals, three whole digits, exponent, blank) is undefined
// - the form reads exactly the six shown settings, never a gift setting, and an unticked box is off
// - a blank banner is no banner; a banner over the limit, a number out of range or not a number, and a rate over 25 percent each name their field
// - a field over the raw limit is refused unread
// - which settings a change touches: only those named whose value differs, in table order; a named setting with the stored value is not a change
// - the save outcome and where it redirects, with the fields to look at for a refused form
// - the form shows the stored values as text; no banner is an empty field
// - the tier list shows name and terms; the paused list links each experience and links to the full list only when there is more

const stored: SettingsRead = {
  version: '20261101000000123456',
  bannerText: null,
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

const valid = {
  bannerText: 'Closed Monday',
  bookingsPaused: 'on',
  holdMinutes: '15',
  paymentGraceMinutes: '5',
  checkoutMaintenance: 'on',
  taxRatePercent: '8.875',
};

const parse = (fields: Record<string, string>) =>
  parseSettingsForm((name) => fields[name] ?? null);

describe('percentToPpm and ppmToPercent', () => {
  it.each([
    ['8.875', 88_750],
    ['0', 0],
    ['25', 250_000],
    ['0.0001', 1],
    ['7.5', 75_000],
    ['08', 80_000],
  ])('%s is %i ppm', (text, ppm) => {
    expect(percentToPpm(text)).toBe(ppm);
  });

  it.each([
    [88_750, '8.875'],
    [0, '0'],
    [250_000, '25'],
    [1, '0.0001'],
    [75_000, '7.5'],
    [100_000, '10'],
  ])('%i ppm shows as %s percent', (ppm, text) => {
    expect(ppmToPercent(ppm)).toBe(text);
  });

  it('round-trips every ppm in the allowed range at its edges', () => {
    for (const ppm of [0, 1, 9_999, 10_000, 88_750, 250_000]) {
      expect(percentToPpm(ppmToPercent(ppm))).toBe(ppm);
    }
  });

  it.each([
    ['nothing', undefined],
    ['blank', ''],
    ['a sign', '-1'],
    ['a plus', '+5'],
    ['a comma', '8,5'],
    ['five decimals', '8.12345'],
    ['three whole digits', '100'],
    ['a bare point', '8.'],
    ['an exponent', '1e1'],
    ['words', 'eight'],
  ])('refuses %s', (_name, text) => {
    expect(percentToPpm(text)).toBeUndefined();
  });
});

describe('parseSettingsForm', () => {
  it('reads the six settings and nothing else', () => {
    expect(
      parse({ ...valid, giftsEnabled: 'on', giftValidityMonths: '3' }),
    ).toEqual({
      ok: true,
      value: {
        bannerText: 'Closed Monday',
        bookingsPaused: true,
        holdMinutes: 15,
        paymentGraceMinutes: 5,
        checkoutMaintenance: true,
        taxRatePpm: 88_750,
      },
    });
  });

  it('reads an unticked box as off and a blank banner as none', () => {
    expect(
      parse({
        holdMinutes: '15',
        paymentGraceMinutes: '5',
        taxRatePercent: '8.875',
        bannerText: '   ',
      }),
    ).toMatchObject({
      ok: true,
      value: {
        bannerText: null,
        bookingsPaused: false,
        checkoutMaintenance: false,
      },
    });
  });

  it.each<[string, Record<string, string>, SettingsFormField[]]>([
    [
      'a banner over the limit',
      { bannerText: 'x'.repeat(settingsBounds.bannerChars + 1) },
      ['bannerText'],
    ],
    ['a hold of 0', { holdMinutes: '0' }, ['holdMinutes']],
    ['a hold of 61', { holdMinutes: '61' }, ['holdMinutes']],
    ['a hold that is not a number', { holdMinutes: '1.5' }, ['holdMinutes']],
    ['no hold', { holdMinutes: '' }, ['holdMinutes']],
    ['a grace of 31', { paymentGraceMinutes: '31' }, ['paymentGraceMinutes']],
    [
      'a rate over 25 percent',
      { taxRatePercent: '25.0001' },
      ['taxRatePercent'],
    ],
    [
      'a rate that is not a percent',
      { taxRatePercent: 'eight' },
      ['taxRatePercent'],
    ],
    [
      'several at once, in form order',
      { taxRatePercent: '30', holdMinutes: '0', bannerText: 'x'.repeat(281) },
      ['bannerText', 'holdMinutes', 'taxRatePercent'],
    ],
  ])('refuses %s and names the field', (_name, over, fields) => {
    expect(parse({ ...valid, ...over })).toEqual({ ok: false, fields });
  });

  it('accepts the edges of every bound', () => {
    expect(
      parse({
        ...valid,
        holdMinutes: '1',
        paymentGraceMinutes: '0',
        taxRatePercent: '25',
      }),
    ).toMatchObject({ ok: true });
    expect(
      parse({
        ...valid,
        holdMinutes: '60',
        paymentGraceMinutes: '30',
        taxRatePercent: '0',
      }),
    ).toMatchObject({ ok: true });
  });

  it('refuses a field over the raw limit unread', () => {
    expect(parse({ ...valid, taxRatePercent: '9'.repeat(5000) })).toEqual({
      ok: false,
      fields: ['taxRatePercent'],
    });
  });
});

describe('changedSettingKeys', () => {
  it.each([
    ['a different hold', { holdMinutes: 15 }, ['holdMinutes']],
    ['the stored hold', { holdMinutes: 10 }, []],
    ['a banner set', { bannerText: 'Hello' }, ['bannerText']],
    ['no banner on none', { bannerText: null }, []],
    [
      'several, in table order',
      { taxRatePpm: 1, bookingsPaused: true, holdMinutes: 12 },
      ['bookingsPaused', 'holdMinutes', 'taxRatePpm'],
    ],
    [
      'some changed and some stored',
      { holdMinutes: 10, giftsEnabled: false },
      ['giftsEnabled'],
    ],
    [
      'a key set to undefined',
      { holdMinutes: undefined, taxRatePpm: 5 },
      ['taxRatePpm'],
    ],
  ])('%s', (_name, change, expected) => {
    expect(changedSettingKeys(stored, change)).toEqual(expected);
  });
});

describe('the save outcome and where it goes', () => {
  it('is unchanged for no changed setting and saved otherwise', () => {
    expect(settingsSaveOutcome([])).toBe('unchanged');
    expect(settingsSaveOutcome(['holdMinutes'])).toBe('saved');
  });

  it.each([
    [{ status: 'saved' as const }, '/ops/settings?notice=saved'],
    [{ status: 'unchanged' as const }, '/ops/settings?notice=unchanged'],
    [{ status: 'stale' as const }, '/ops/settings?notice=stale'],
    [
      {
        status: 'invalid' as const,
        fields: ['holdMinutes', 'taxRatePercent'] as const,
      },
      '/ops/settings?notice=invalid&fields=holdMinutes%2CtaxRatePercent',
    ],
  ])('%j goes to %s', (outcome, href) => {
    expect(settingsSaveNext(outcome)).toBe(href);
  });
});

describe('settingsFormValues', () => {
  it('shows the stored settings as text and flags', () => {
    expect(
      settingsFormValues({ ...stored, bannerText: 'Hi', bookingsPaused: true }),
    ).toEqual({
      version: '20261101000000123456',
      bannerText: 'Hi',
      bookingsPaused: true,
      holdMinutes: '10',
      paymentGraceMinutes: '5',
      checkoutMaintenance: false,
      taxRatePercent: '8.875',
    });
  });

  it('shows no banner as an empty field', () => {
    expect(settingsFormValues(stored).bannerText).toBe('');
  });
});

describe('the version a save must still match', () => {
  const get = (value: string | undefined) => (name: string) =>
    name === 'version' ? (value ?? null) : null;

  it('reads a 20 digit version from the form, trimmed', () => {
    expect(parseSettingsVersion(get(' 20261101000000123456 '))).toBe(
      '20261101000000123456',
    );
  });

  it.each([
    ['missing', undefined],
    ['blank', '  '],
    ['too short', '2026110100000012345'],
    ['too long', '202611010000001234567'],
    ['not digits', '2026110100000012345a'],
    ['oversized', '9'.repeat(100_000)],
    ['a decimal', '2026110100000012.456'],
  ])('reads a version that is %s as none', (_name, value) => {
    expect(parseSettingsVersion(get(value))).toBeNull();
  });

  it('reads a file as none', () => {
    expect(parseSettingsVersion(() => new File([], 'v'))).toBeNull();
  });

  it('matches only the identical stored version', () => {
    const version = '20261101000000123456';
    expect(settingsVersionIsCurrent(version, version)).toBe(true);
    expect(settingsVersionIsCurrent('20261101000000123457', version)).toBe(
      false,
    );
  });

  it('never matches a missing version, even against an empty stored one', () => {
    expect(settingsVersionIsCurrent(null, '20261101000000123456')).toBe(false);
    expect(settingsVersionIsCurrent(null, '')).toBe(false);
  });

  it('says in plain words that nothing was saved and the form is current', () => {
    expect(settingsNotices.stale.tone).toBe('warning');
    expect(settingsNotices.stale.title).toMatch(
      /nothing was saved.*current values/,
    );
  });
});

describe('how a save attempt ends', () => {
  it('is stale for a stale refusal', () => {
    expect(settingsSaveStatus(new StaleSettingsError())).toBe('stale');
  });

  it('is saved or unchanged by what the save changed', () => {
    expect(settingsSaveStatus({ changed: ['holdMinutes'] })).toBe('saved');
    expect(settingsSaveStatus({ changed: [] })).toBe('unchanged');
  });

  it('hands back a stale refusal and throws anything else again', () => {
    const stale = new StaleSettingsError();
    expect(asStaleSettings(stale)).toBe(stale);
    const other = new Error('down');
    expect(() => asStaleSettings(other)).toThrow(other);
  });
});

describe('cancellationTierRows', () => {
  it('names each tier with what it promises, and marks the default', () => {
    const rows = cancellationTierRows([
      {
        id: 'a',
        key: 'flex',
        name: 'Flexible',
        fullRefundHoursBefore: 24,
        isDefault: true,
      },
      {
        id: 'b',
        key: 'strict',
        name: 'Strict',
        fullRefundHoursBefore: 168,
        isDefault: false,
      },
    ]);
    expect(rows).toEqual([
      {
        id: 'a',
        name: 'Flexible',
        terms: 'Free cancellation up to 24 hours before',
        isDefault: true,
      },
      {
        id: 'b',
        name: 'Strict',
        terms: 'Free cancellation up to 7 days before',
        isDefault: false,
      },
    ]);
  });
});

describe('pausedExperienceSummary', () => {
  const rows = [{ id: 'e1', name: 'Kayak', hostName: 'Spoke' }];

  it('links each experience to its ops page and has no full-list link on the last page', () => {
    expect(pausedExperienceSummary({ rows, nextCursor: null })).toEqual({
      rows: [
        {
          id: 'e1',
          name: 'Kayak',
          hostName: 'Spoke',
          href: '/ops/experiences/e1',
        },
      ],
      moreHref: null,
    });
  });

  it('links to the paused list when there are more than the first page', () => {
    expect(pausedExperienceSummary({ rows, nextCursor: 'c' }).moreHref).toBe(
      '/ops/experiences?status=paused',
    );
  });
});
