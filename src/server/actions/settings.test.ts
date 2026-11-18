import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  opsCallerOrLeave: vi.fn(),
  updateSettings: vi.fn(),
}));

class Redirected extends Error {
  constructor(readonly href: string) {
    super(href);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Redirected(href);
  },
}));
vi.mock('@/server/opsAccess', () => ({
  opsCallerOrLeave: mocks.opsCallerOrLeave,
}));
vi.mock('@/server/db/settings', () => ({
  updateSettings: mocks.updateSettings,
}));

import { StaleSettingsError } from '@/lib/opsSettings';
import { updateSettingsAction } from './settings';

// Behaviours under test:
// - the caller is checked first: a caller sent away saves nothing
// - a refused form redirects with the invalid notice and the fields to look at, and saves nothing
// - the six parsed settings, and no gift setting even if posted, reach the data layer with the ops caller
// - a save that changed something redirects with saved, and one that changed nothing with unchanged
// - a form with no readable version, or a save the data layer refuses as stale, redirects with the stale notice before or without saving
// - an error from the data layer is not caught here

const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const version = '20261101000000123456';
const valid = {
  version,
  bannerText: 'Closed Monday',
  holdMinutes: '15',
  paymentGraceMinutes: '5',
  taxRatePercent: '8.875',
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.opsCallerOrLeave.mockResolvedValue(ops);
});

describe('updateSettingsAction', () => {
  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/settings'));
    await expect(updateSettingsAction(form(valid))).rejects.toMatchObject({
      href: '/ops/settings',
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('redirects a refused form with the fields to look at and saves nothing', async () => {
    await expect(
      updateSettingsAction(form({ ...valid, holdMinutes: '0' })),
    ).rejects.toMatchObject({
      href: '/ops/settings?notice=invalid&fields=holdMinutes',
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it('saves the six settings as parsed and never a gift setting', async () => {
    mocks.updateSettings.mockResolvedValue({ changed: ['holdMinutes'] });
    await expect(
      updateSettingsAction(
        form({
          ...valid,
          bookingsPaused: 'on',
          giftsEnabled: 'on',
          giftValidityMonths: '3',
        }),
      ),
    ).rejects.toMatchObject({ href: '/ops/settings?notice=saved' });
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      ops,
      {
        bannerText: 'Closed Monday',
        bookingsPaused: true,
        holdMinutes: 15,
        paymentGraceMinutes: 5,
        checkoutMaintenance: false,
        taxRatePpm: 88_750,
      },
      version,
    );
  });

  it('redirects a save that changed nothing with the unchanged notice', async () => {
    mocks.updateSettings.mockResolvedValue({ changed: [] });
    await expect(updateSettingsAction(form(valid))).rejects.toMatchObject({
      href: '/ops/settings?notice=unchanged',
    });
  });

  it('redirects a save the data layer refuses as stale with the stale notice', async () => {
    mocks.updateSettings.mockRejectedValue(new StaleSettingsError());
    await expect(updateSettingsAction(form(valid))).rejects.toMatchObject({
      href: '/ops/settings?notice=stale',
    });
  });

  it('hands a form with no readable version to the data layer as none, which refuses it', async () => {
    mocks.updateSettings.mockRejectedValue(new StaleSettingsError());
    await expect(
      updateSettingsAction(form({ ...valid, version: 'nope' })),
    ).rejects.toMatchObject({ href: '/ops/settings?notice=stale' });
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      ops,
      expect.anything(),
      null,
    );
  });

  it('lets a data layer failure through', async () => {
    mocks.updateSettings.mockRejectedValue(new Error('down'));
    await expect(updateSettingsAction(form(valid))).rejects.toThrow('down');
  });
});
