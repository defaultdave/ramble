import { describe, expect, it } from 'vitest';
import {
  evaluateFormGuard,
  FORM_TOKEN_FIELD,
  FormGuardFieldsSchema,
  HONEYPOT_FIELD,
  DEVELOPMENT_FORM_GUARD_SECRET,
  maxFieldLength,
  MAX_FORM_AGE_MS,
  MIN_FILL_MS,
  parseFormGuardToken,
  pickFormGuardSecret,
  type FormGuardResult,
} from './formGuard';

const issuedAt = new Date('2026-11-01T12:00:00Z');
const after = (ms: number) => new Date(issuedAt.getTime() + ms);

describe('evaluateFormGuard', () => {
  it.each<[string, string | undefined, Date, FormGuardResult]>([
    ['a person who took ten seconds', undefined, after(10_000), { ok: true }],
    ['an empty honeypot', '', after(10_000), { ok: true }],
    [
      'exactly the minimum fill time',
      undefined,
      after(MIN_FILL_MS),
      { ok: true },
    ],
    [
      'one millisecond under the minimum',
      undefined,
      after(MIN_FILL_MS - 1),
      { ok: false, reason: 'too_fast' },
    ],
    [
      'a form submitted at the instant it rendered',
      undefined,
      after(0),
      { ok: false, reason: 'too_fast' },
    ],
    [
      'a token from the future',
      undefined,
      after(-60_000),
      { ok: false, reason: 'too_fast' },
    ],
    [
      'exactly the maximum age',
      undefined,
      after(MAX_FORM_AGE_MS),
      { ok: true },
    ],
    [
      'one millisecond past the maximum age',
      undefined,
      after(MAX_FORM_AGE_MS + 1),
      { ok: false, reason: 'expired' },
    ],
    [
      'a filled honeypot, however long it took',
      'https://spam.example',
      after(10_000),
      { ok: false, reason: 'honeypot_filled' },
    ],
    [
      'a filled honeypot on an expired form',
      'x',
      after(MAX_FORM_AGE_MS * 2),
      { ok: false, reason: 'honeypot_filled' },
    ],
  ])('judges %s', (_name, honeypot, now, expected) => {
    expect(evaluateFormGuard({ honeypot, issuedAt, now })).toEqual(expected);
  });

  it('fails closed on a time that is not a date', () => {
    expect(
      evaluateFormGuard({
        honeypot: undefined,
        issuedAt: new Date(NaN),
        now: after(10_000),
      }),
    ).toEqual({ ok: false, reason: 'invalid_token' });
  });
});

describe('FormGuardFieldsSchema', () => {
  const token = 'abc';

  it('accepts a token with no honeypot value', () => {
    expect(
      FormGuardFieldsSchema.safeParse({ [FORM_TOKEN_FIELD]: token }).success,
    ).toBe(true);
  });

  it.each([
    ['no token', {}],
    ['an empty token', { [FORM_TOKEN_FIELD]: '' }],
    [
      'a token past the length cap',
      { [FORM_TOKEN_FIELD]: 'x'.repeat(maxFieldLength + 1) },
    ],
    [
      'a honeypot value past the length cap',
      {
        [FORM_TOKEN_FIELD]: token,
        [HONEYPOT_FIELD]: 'x'.repeat(maxFieldLength + 1),
      },
    ],
    [
      'a file in the honeypot',
      { [FORM_TOKEN_FIELD]: token, [HONEYPOT_FIELD]: {} },
    ],
  ])('refuses %s', (_name, fields) => {
    expect(FormGuardFieldsSchema.safeParse(fields).success).toBe(false);
  });
});

describe('parseFormGuardToken', () => {
  const signature = 'A'.repeat(43);

  it('reads the time and the signature', () => {
    expect(parseFormGuardToken(`1793534400000.${signature}`)).toEqual({
      issuedAt: new Date(1793534400000),
      issuedAtMs: '1793534400000',
      signature,
    });
  });

  it.each([
    ['empty', ''],
    ['no signature', '1793534400000'],
    ['empty signature', '1793534400000.'],
    ['empty time', `.${signature}`],
    ['non-numeric time', `soon.${signature}`],
    ['signed time', `-1.${signature}`],
    ['time of 16 digits', `${'1'.repeat(16)}.${signature}`],
    ['short signature', `1.${'A'.repeat(42)}`],
    ['long signature', `1.${'A'.repeat(44)}`],
    ['padded signature', `1.${'A'.repeat(43)}=`],
    ['standard base64 alphabet', `1.${'+'.repeat(43)}`],
    ['trailing newline', `1.${signature}\n`],
    ['trailing space', `1.${signature} `],
    ['leading space', ` 1.${signature}`],
    ['extra part', `1.${signature}.x`],
  ])('refuses %s', (_name, token) => {
    expect(parseFormGuardToken(token)).toBeNull();
  });
});

describe('pickFormGuardSecret', () => {
  it.each([
    [
      'a configured secret anywhere',
      's'.repeat(32),
      'production',
      's'.repeat(32),
    ],
    [
      'nothing in development',
      undefined,
      'development',
      DEVELOPMENT_FORM_GUARD_SECRET,
    ],
    ['nothing under test', undefined, 'test', DEVELOPMENT_FORM_GUARD_SECRET],
    ['nothing in production', undefined, 'production', null],
  ] as const)('picks for %s', (_name, configured, nodeEnv, expected) => {
    expect(pickFormGuardSecret(configured, nodeEnv)).toBe(expected);
  });
});
