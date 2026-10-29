import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deviceCookieMaxAgeSeconds,
  deviceCookieName,
  isDeviceCookie,
} from '@/lib/device';

const state = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  forwardedFor: null as string | null,
  nodeEnv: 'test',
  set: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'ramble_device' && state.cookie !== undefined
          ? { name, value: state.cookie }
          : undefined,
      set: state.set,
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'x-forwarded-for' ? state.forwardedFor : null,
    }),
}));
vi.mock('@/server/env', () => ({
  env: {
    get NODE_ENV() {
      return state.nodeEnv;
    },
  },
}));

import { deviceFrom, getDevice } from './device';

// Behaviours under test, one per decision, branch or risk:
// - a valid cookie is the device: the key is its sha-256, the address hash is the sha-256 of the
//   first forwarded address, and no cookie is written
// - no cookie, or one this app did not mint, mints a new 32-byte cookie, set httpOnly, SameSite Lax,
//   path /, 400 days, and Secure in production only
// - the same cookie from another address is the same device key with another address hash
// - an absent or malformed address hashes as "unknown", so a forged header cannot grow the key space
// - the device is a plain pair of hashes: the cookie value never appears in it

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const minted = 'A'.repeat(43);

beforeEach(() => {
  state.cookie = undefined;
  state.forwardedFor = null;
  state.nodeEnv = 'test';
  state.set.mockReset();
});

describe('getDevice', () => {
  it('reads a valid cookie without setting one', async () => {
    state.cookie = minted;
    state.forwardedFor = '203.0.113.9, 10.0.0.1';

    const device = await getDevice();

    expect(device.deviceKey).toBe(sha256(minted));
    expect(device.ipHash).toBe(sha256('203.0.113.9'));
    expect(state.set).not.toHaveBeenCalled();
  });

  it.each([
    ['no cookie', undefined],
    ['a cookie of the wrong shape', 'not-a-device-cookie'],
    ['an empty cookie', ''],
  ])('mints a cookie for %s', async (_name, stored) => {
    state.cookie = stored;

    const device = await getDevice();

    expect(state.set).toHaveBeenCalledOnce();
    const [name, value, options] = state.set.mock.calls[0] as [
      string,
      string,
      object,
    ];
    expect(name).toBe(deviceCookieName);
    expect(isDeviceCookie(value)).toBe(true);
    expect(options).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: deviceCookieMaxAgeSeconds,
    });
    expect(device.deviceKey).toBe(sha256(value));
  });

  it('mints a different cookie each time', async () => {
    await getDevice();
    await getDevice();

    expect(state.set.mock.calls[0]?.[1]).not.toBe(state.set.mock.calls[1]?.[1]);
  });

  it('marks the cookie Secure in production', async () => {
    state.nodeEnv = 'production';

    await getDevice();

    expect(state.set.mock.calls[0]?.[2]).toMatchObject({ secure: true });
  });

  it('keeps the device key when only the address changes', async () => {
    state.cookie = minted;
    state.forwardedFor = '203.0.113.9';
    const first = await getDevice();
    state.forwardedFor = '198.51.100.4';
    const second = await getDevice();

    expect(second.deviceKey).toBe(first.deviceKey);
    expect(second.ipHash).not.toBe(first.ipHash);
  });

  it.each([null, '', 'not an address', `${'1'.repeat(46)}`])(
    'hashes %j as the shared unknown address',
    async (header) => {
      state.cookie = minted;
      state.forwardedFor = header;

      expect((await getDevice()).ipHash).toBe(sha256('unknown'));
    },
  );
});

describe('deviceFrom', () => {
  it('holds hashes only, never the cookie', () => {
    const device = deviceFrom(minted, '203.0.113.9');

    expect(JSON.stringify(device)).not.toContain(minted);
    expect(device.deviceKey).toMatch(/^[0-9a-f]{64}$/);
    expect(device.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
