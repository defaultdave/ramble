import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedGuestSettings } from './siteSettings';

// Behaviours under test, one per decision, branch or risk:
// - the read names the settings profile and tags itself with the settings tag, so saving settings reaches it
// - a failed read throws only the kind of the failure, never the query or its values

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheLife: cache.life,
  cacheTag: cache.tag,
}));

const db = vi.hoisted(() => ({ settings: vi.fn() }));
vi.mock('@/server/db/settings', () => ({ getGuestSettings: db.settings }));

const guest = {
  bannerText: 'Closed Monday',
  bookingsPaused: false,
  giftsEnabled: true,
  checkoutMaintenance: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCachedGuestSettings', () => {
  it('uses the settings profile and tags the settings', async () => {
    db.settings.mockResolvedValue(guest);

    await expect(getCachedGuestSettings()).resolves.toEqual(guest);

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('settings');
    expect(cache.tag).toHaveBeenCalledExactlyOnceWith('settings');
  });

  it('throws only the kind of a failed read', async () => {
    db.settings.mockRejectedValue(
      new Error('Failed query: select ... params: secret-banner'),
    );

    const failure = await getCachedGuestSettings().catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({
      message: 'Settings read failed: Error',
    });
    expect(JSON.stringify(failure)).not.toContain('secret-banner');
  });
});
