import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { clientAddress } from '@/lib/clientAddress';
import {
  deviceCookieMaxAgeSeconds,
  deviceCookieName,
  isDeviceCookie,
} from '@/lib/device';

declare const deviceBrand: unique symbol;

/**
 * The guest on a hold: who a device is, as hashes. It is the subject check for a guest's rows that
 * are keyed by device (holds, and what is made under a hold), the way `Caller` is for signed-in
 * roles (DECISIONS 2026-10-28, Q1). The brand is not exported, so only this module can build one.
 */
export type Device = {
  /** sha-256 of the device cookie, hex. */
  readonly deviceKey: string;
  /** sha-256 of the client address, hex: the secondary limit key. */
  readonly ipHash: string;
  readonly [deviceBrand]: true;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The device behind a cookie value and a forwarded-for header. Only a value that passes
 * `isDeviceCookie` becomes a device, so a caller cannot mint one from an arbitrary string. A plain
 * sha-256 of an address can be reversed by trying every address, which the rate-limit keys already
 * accept: a keyed hash would need a new secret.
 */
function deviceFrom(cookieValue: string, forwardedFor: string | null): Device {
  if (!isDeviceCookie(cookieValue)) {
    throw new TypeError('A device comes only from a device cookie');
  }
  return {
    deviceKey: sha256(cookieValue),
    ipHash: sha256(clientAddress(forwardedFor)),
  } as Device;
}

/**
 * The calling device, from its cookie. A request with no cookie, or one that is not a value this
 * app minted, gets a new cookie in the action's response, so a guest page render never sets one
 * (guest routes send no cookies, B14). Call it from a Server Action only.
 */
export async function getDevice(): Promise<Device> {
  const jar = await cookies();
  const stored = jar.get(deviceCookieName)?.value;
  let value: string;
  if (isDeviceCookie(stored)) {
    value = stored;
  } else {
    value = randomBytes(32).toString('base64url');
    jar.set(deviceCookieName, value, {
      httpOnly: true,
      // Browsers accept a Secure cookie on http://localhost, so local runs keep working.
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: deviceCookieMaxAgeSeconds,
    });
  }
  return deviceFrom(value, (await headers()).get('x-forwarded-for'));
}
