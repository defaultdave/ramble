import { describe, expect, it } from 'vitest';
import { alertTag, prepareAlert, runbookUrl } from './alerts';

describe('prepareAlert', () => {
  it('derives the title, runbook link, and Sentry fingerprint', () => {
    expect(
      prepareAlert({
        kind: 'payment-mismatch',
        severity: 'error',
        dedupeKey: 'order:ord_123',
      }),
    ).toEqual({
      kind: 'payment-mismatch',
      severity: 'error',
      dedupeKey: 'order:ord_123',
      level: 'error',
      title: 'payment-mismatch: order:ord_123',
      runbookUrl:
        'https://github.com/defaultdave/ramble/blob/main/docs/runbooks/payment-mismatch.md',
      fingerprint: ['payment-mismatch', 'order:ord_123'],
    });
  });

  it.each([
    ['warning', 'warning'],
    ['error', 'error'],
    ['critical', 'fatal'],
  ] as const)('maps severity %s to the Sentry level %s', (severity, level) => {
    expect(prepareAlert({ kind: 'a-b', severity, dedupeKey: 'k' }).level).toBe(
      level,
    );
  });

  it('gives one runbook link per kind', () => {
    expect(runbookUrl('refund-failed')).toMatch(
      /\/docs\/runbooks\/refund-failed\.md$/,
    );
  });

  it.each([
    [
      'an uppercase kind',
      { kind: 'Payment', severity: 'error', dedupeKey: 'k' },
    ],
    ['a kind with a slash', { kind: 'a/b', severity: 'error', dedupeKey: 'k' }],
    ['a kind with a dot', { kind: 'a.b', severity: 'error', dedupeKey: 'k' }],
    [
      'a kind with a trailing hyphen',
      { kind: 'ab-', severity: 'error', dedupeKey: 'k' },
    ],
    ['an empty kind', { kind: '', severity: 'error', dedupeKey: 'k' }],
    [
      'a kind over 48 characters',
      { kind: 'a'.repeat(49), severity: 'error', dedupeKey: 'k' },
    ],
    ['an unknown severity', { kind: 'ab', severity: 'urgent', dedupeKey: 'k' }],
    ['an empty dedupe key', { kind: 'ab', severity: 'error', dedupeKey: '' }],
    [
      'a dedupe key with a space',
      { kind: 'ab', severity: 'error', dedupeKey: 'a b' },
    ],
    [
      'a dedupe key holding an email',
      { kind: 'ab', severity: 'error', dedupeKey: 'a@b.co' },
    ],
    [
      'a dedupe key over 100 characters',
      { kind: 'ab', severity: 'error', dedupeKey: 'k'.repeat(101) },
    ],
  ])('refuses %s without repairing it', (_name, input) => {
    expect(() => prepareAlert(input)).toThrow();
  });

  it.each([
    ['a 64-character hex digest', 'a1'.repeat(32)],
    ['a base64url token', 'q7Hk2mVx9RtLw3NfZ8bYc1DsJ6aPe4UoG0iAhXnT5vE'],
    [
      'a key prefixed by a token',
      'order:q7Hk2mVx9RtLw3NfZ8bYc1DsJ6aPe4UoG0iAhXnT5vE',
    ],
    ['a Stripe key', 'sk_live_51Habcdefghijklmnop'],
  ])(
    'refuses a dedupe key that looks like a secret: %s',
    (_name, dedupeKey) => {
      expect(() =>
        prepareAlert({ kind: 'ab', severity: 'error', dedupeKey }),
      ).toThrow(/secret/);
    },
  );

  it.each([
    ['a UUID', '9f1c2b7e-4d5a-4e8b-9c3d-1a2b3c4d5e6f'],
    ['a record key', 'order:ord_123'],
    ['a date', 'recon:2026-10-25'],
    ['a long lowercase name', 'daily-balance-reconciliation-mismatch-report'],
  ])('accepts a dedupe key that is %s', (_name, dedupeKey) => {
    expect(
      prepareAlert({ kind: 'ab', severity: 'error', dedupeKey }).fingerprint,
    ).toEqual(['ab', dedupeKey]);
  });

  it('exposes the tag the Sentry alert rules filter on', () => {
    expect(alertTag).toBe('ramble_alert');
  });
});
