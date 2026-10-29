import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDevice } from '@/server/test-device';

const mocks = vi.hoisted(() => ({
  checkBot: vi.fn(),
  consumeRateLimit: vi.fn(),
  reserveSpacesRow: vi.fn(),
  releaseHoldRow: vi.fn(),
  currentDatabaseTime: vi.fn(),
  getDevice: vi.fn(),
}));

vi.mock('@/server/ports/rate-limit/bot-check', () => ({
  checkBot: mocks.checkBot,
}));
vi.mock('@/server/ports/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock('@/server/db/holds', () => ({
  reserveSpaces: mocks.reserveSpacesRow,
  releaseHold: mocks.releaseHoldRow,
}));
vi.mock('@/server/db/time', () => ({
  currentDatabaseTime: mocks.currentDatabaseTime,
}));
vi.mock('@/server/device', async (importActual) => ({
  ...(await importActual<typeof import('@/server/device')>()),
  getDevice: mocks.getDevice,
}));

import { releaseHold, reserveSpaces } from './holds';

// Behaviours under test, one per decision, branch or risk:
// - reserve asks BotID first: a bot is blocked with no end time, spends no try, and reaches no data layer
// - reserve spends one try on the reserve surface for the device key; a refused try is blocked with
//   an end time from the database clock, and reaches no data layer
// - a person within the limit reaches the data layer with their device and the input, unparsed
// - a failed bot lookup or a failed limit store rejects, and nothing is held (fail closed)
// - release goes to the data layer with the calling device and the input

const device = testDevice('reserve-door');
const input = {
  sessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  items: [
    { priceOptionId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', quantity: 1 },
  ],
  purpose: 'booking' as const,
};
const held = { status: 'held' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDevice.mockResolvedValue(device);
  mocks.checkBot.mockResolvedValue('human');
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
  mocks.reserveSpacesRow.mockResolvedValue(held);
  mocks.currentDatabaseTime.mockResolvedValue(
    new Date('2026-11-01T12:00:00.000Z'),
  );
});

describe('the reserve action', () => {
  it('blocks a bot without spending a try or touching the data layer', async () => {
    mocks.checkBot.mockResolvedValue('bot');

    await expect(reserveSpaces(input)).resolves.toEqual({
      status: 'blocked',
      reason: 'too_many_holds',
    });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.reserveSpacesRow).not.toHaveBeenCalled();
  });

  it('spends one try on the device key and passes a person through', async () => {
    await expect(reserveSpaces(input)).resolves.toBe(held);

    expect(mocks.consumeRateLimit).toHaveBeenCalledExactlyOnceWith(
      'reserve',
      device.deviceKey,
    );
    expect(mocks.reserveSpacesRow).toHaveBeenCalledExactlyOnceWith(
      device,
      input,
    );
  });

  it('blocks a device over its limit until the window frees a try', async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
    });

    await expect(reserveSpaces(input)).resolves.toEqual({
      status: 'blocked',
      reason: 'too_many_holds',
      until: '2026-11-01T12:02:00.000Z',
    });
    expect(mocks.reserveSpacesRow).not.toHaveBeenCalled();
  });

  it('rejects when the bot lookup fails, holding nothing and spending nothing', async () => {
    mocks.checkBot.mockRejectedValue(new Error('BotID unreachable'));

    await expect(reserveSpaces(input)).rejects.toThrow('BotID unreachable');
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.reserveSpacesRow).not.toHaveBeenCalled();
  });

  it('rejects when the limit store fails, holding nothing', async () => {
    mocks.consumeRateLimit.mockRejectedValue(new Error('connection refused'));

    await expect(reserveSpaces(input)).rejects.toThrow('connection refused');
    expect(mocks.reserveSpacesRow).not.toHaveBeenCalled();
  });
});

describe('the release action', () => {
  it('releases for the calling device', async () => {
    const released = { status: 'released' };
    mocks.releaseHoldRow.mockResolvedValue(released);

    await expect(releaseHold({ holdId: input.sessionId })).resolves.toBe(
      released,
    );
    expect(mocks.releaseHoldRow).toHaveBeenCalledExactlyOnceWith(device, {
      holdId: input.sessionId,
    });
  });
});
