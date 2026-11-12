import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountBookingData } from '@/lib/accountBookings';
import { managePath } from '@/lib/routes';
import { Role, anonymousCaller, getCaller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { readAccountBookings } from '@/server/db/accountBookings';
import { capabilityToken } from '@/server/tokens';
import { loadAccountBookings } from './accountBookings';

vi.mock('@/server/auth/caller', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/caller')>()),
  getCaller: vi.fn(),
}));
vi.mock('@/server/db/accountBookings', () => ({
  readAccountBookings: vi.fn(),
}));

// Behaviours under test, one per decision, branch or risk:
// - nobody signed in is told to sign in, and the database is never asked, whether the caller has no id or an id with a role
// - a signed-in caller's bookings are read as that caller
// - each booking's manage link is the `manage` token at that order's own version, rebuilt per row, not the order or gift kind and not version 1
// - the clock decides what is still ahead: a confirmed booking after now is upcoming, one before it is past

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (
  n: number,
  startsAt: string,
  manageTokenVersion: number,
): AccountBookingData => ({
  id: id(n),
  reference: `RMB-00000${String(n)}`,
  experienceName: 'Sunset kayak',
  sessionStartsAt: new Date(startsAt),
  timeZone: 'America/New_York',
  status: 'confirmed',
  manageTokenVersion,
});

beforeEach(() => {
  vi.mocked(getCaller).mockReset();
  vi.mocked(readAccountBookings).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadAccountBookings', () => {
  it.each([
    ['nobody signed in', anonymousCaller],
    [
      'a caller with a role but no id',
      { userId: null, roles: [Role.Guest], hostIds: [] },
    ],
  ])('says signed out for %s and reads nothing', async (_name, caller) => {
    vi.mocked(getCaller).mockResolvedValue(caller);

    expect(await loadAccountBookings()).toEqual({ status: 'signed_out' });
    expect(readAccountBookings).not.toHaveBeenCalled();
  });

  it('reads the bookings as the caller who is signed in', async () => {
    const caller = testCaller();
    vi.mocked(getCaller).mockResolvedValue(caller);
    vi.mocked(readAccountBookings).mockResolvedValue([]);

    expect(await loadAccountBookings()).toEqual({
      status: 'ok',
      view: { upcoming: [], past: [] },
    });
    expect(readAccountBookings).toHaveBeenCalledWith(caller);
  });

  it('links each booking with the manage token at its own version', async () => {
    vi.mocked(getCaller).mockResolvedValue(testCaller());
    vi.mocked(readAccountBookings).mockResolvedValue([
      row(1, '2026-11-12T15:00:00Z', 3),
      row(2, '2026-11-13T15:00:00Z', 7),
    ]);

    const result = await loadAccountBookings();

    if (result.status !== 'ok') throw new Error('expected a view');
    const [first, second] = result.view.upcoming;
    expect(first?.manageHref).toBe(
      managePath(capabilityToken('manage', id(1), 3)),
    );
    expect(second?.manageHref).toBe(
      managePath(capabilityToken('manage', id(2), 7)),
    );
    expect(first?.manageHref).not.toBe(second?.manageHref);
    expect(first?.manageHref).not.toBe(
      managePath(capabilityToken('manage', id(1), 1)),
    );
    expect(first?.manageHref).not.toBe(
      managePath(capabilityToken('order', id(1), 3)),
    );
  });

  it('splits upcoming from past on the clock', async () => {
    vi.mocked(getCaller).mockResolvedValue(testCaller());
    vi.mocked(readAccountBookings).mockResolvedValue([
      row(1, '2026-11-12T15:00:00Z', 1),
      row(2, '2026-11-01T15:00:00Z', 1),
    ]);

    const result = await loadAccountBookings();

    if (result.status !== 'ok') throw new Error('expected a view');
    expect(result.view.upcoming.map((b) => b.id)).toEqual([id(1)]);
    expect(result.view.past.map((b) => b.id)).toEqual([id(2)]);
  });
});
