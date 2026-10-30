import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deviceCookieMaxAgeSeconds,
  deviceCookieName,
  isDeviceCookie,
} from './device';

// Behaviours under test:
// - the cookie is named ramble_device and lasts 400 days
// - a value is a device cookie only if it is 43 base64url characters (32 random bytes)

describe('the device cookie', () => {
  it('is named and sized as the note says', () => {
    expect(deviceCookieName).toBe('ramble_device');
    expect(deviceCookieMaxAgeSeconds).toBe(34_560_000);
  });

  it('accepts what 32 random bytes encode to', () => {
    expect(isDeviceCookie(randomBytes(32).toString('base64url'))).toBe(true);
  });

  it.each([
    ['nothing', undefined],
    ['empty', ''],
    ['one character short', 'a'.repeat(42)],
    ['one character long', 'a'.repeat(44)],
    ['standard base64 characters', `${'a'.repeat(42)}+`],
    ['padding', `${'a'.repeat(42)}=`],
    ['a space', `${'a'.repeat(42)} `],
  ])('refuses %s', (_name, value) => {
    expect(isDeviceCookie(value)).toBe(false);
  });
});
