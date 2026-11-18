import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  readSettings: vi.fn(),
  readExperiencesForOps: vi.fn(),
  listCancellationTiers: vi.fn(),
}));

vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/db/settings', () => ({ readSettings: mocks.readSettings }));
vi.mock('@/server/db/experienceEditor', () => ({
  readExperiencesForOps: mocks.readExperiencesForOps,
}));
vi.mock('@/server/db/policies', () => ({
  listCancellationTiers: mocks.listCancellationTiers,
}));
vi.mock('@/server/actions/settings', () => ({
  updateSettingsAction: vi.fn(),
}));

import { OpsAccessDenied } from '@/components/OpsShell';
import SettingsPage from './page';

// Behaviours under test:
// - a caller without the ops role (a guest, an admin, nobody) gets the access-denied view and nothing is read
// - an ops caller reads the settings, the first page of paused experiences, and the cancellation tiers

const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const props = {
  params: Promise.resolve({}),
  searchParams: Promise.resolve({}),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSettings.mockResolvedValue({
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
  });
  mocks.readExperiencesForOps.mockResolvedValue({ rows: [], nextCursor: null });
  mocks.listCancellationTiers.mockResolvedValue([]);
});

describe('the settings page', () => {
  it.each([
    ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
    ['an admin', { userId: 'a', roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])(
    'shows %s the access-denied view and reads nothing',
    async (_who, caller) => {
      mocks.readOpsCaller.mockResolvedValue(caller);
      const page = await SettingsPage(props);
      expect(isValidElement(page) && page.type).toBe(OpsAccessDenied);
      expect(mocks.readSettings).not.toHaveBeenCalled();
      expect(mocks.readExperiencesForOps).not.toHaveBeenCalled();
      expect(mocks.listCancellationTiers).not.toHaveBeenCalled();
    },
  );

  it('reads the settings, the paused experiences and the tiers for ops', async () => {
    mocks.readOpsCaller.mockResolvedValue(ops);
    await SettingsPage(props);
    expect(mocks.readSettings).toHaveBeenCalledWith(ops);
    expect(mocks.readExperiencesForOps).toHaveBeenCalledWith(
      ops,
      { status: 'paused', hostId: null, categoryId: null },
      null,
    );
    expect(mocks.listCancellationTiers).toHaveBeenCalledOnce();
  });
});
