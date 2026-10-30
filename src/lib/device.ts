import { z } from 'zod';

export const deviceCookieName = 'ramble_device';

/** Browsers cap a cookie's lifetime at about 400 days. */
export const deviceCookieMaxAgeSeconds = 400 * 24 * 60 * 60;

/** 32 random bytes in base64url: 43 characters. Anything else is not a cookie this app minted. */
const DeviceCookieSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function isDeviceCookie(value: string | undefined): value is string {
  return DeviceCookieSchema.safeParse(value).success;
}
