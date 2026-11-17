import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  recordOpsAccess: vi.fn(),
  countExperiencesInReview: vi.fn(),
  countRefundFailedBookings: vi.fn(),
  countOpenSupportRequests: vi.fn(),
  countSessionsToday: vi.fn(),
  readRecentAuditForOps: vi.fn(),
  countOpsPrivateRequests: vi.fn(),
}));

vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/db/audit', () => ({
  recordOpsAccess: mocks.recordOpsAccess,
}));
vi.mock('@/server/db/opsDashboard', () => ({
  countExperiencesInReview: mocks.countExperiencesInReview,
  countRefundFailedBookings: mocks.countRefundFailedBookings,
  countOpenSupportRequests: mocks.countOpenSupportRequests,
  countSessionsToday: mocks.countSessionsToday,
  readRecentAuditForOps: mocks.readRecentAuditForOps,
}));
vi.mock('@/server/db/privateRequests', () => ({
  countOpsPrivateRequests: mocks.countOpsPrivateRequests,
}));

import { OpsDashboard } from '@/components/OpsDashboard';
import { OpsAccessDenied, OpsLanding } from '@/components/OpsShell';
import { opsLandingLinks } from '@/lib/opsNav';
import OperationsPage from './page';

// Behaviours under test:
// - a caller without the ops role (a guest, an admin, nobody) gets the access-denied view, and nothing is recorded or read
// - an ops caller's visit is recorded, then every count and the latest five audit rows are read for that caller
// - the landing keeps the list of areas and hands the dashboard the counts it read, each in its own tile

const ops = { userId: 'u', roles: ['ops'], hostIds: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.countExperiencesInReview.mockResolvedValue(3);
  mocks.countRefundFailedBookings.mockResolvedValue(1);
  mocks.countOpenSupportRequests.mockResolvedValue(12);
  mocks.countOpsPrivateRequests.mockResolvedValue(7);
  mocks.countSessionsToday.mockResolvedValue(5);
  mocks.readRecentAuditForOps.mockResolvedValue([]);
});

describe('the operations page', () => {
  it.each([
    ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
    ['an admin', { userId: 'a', roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])(
    'shows %s the access-denied view and reads nothing',
    async (_who, caller) => {
      mocks.readOpsCaller.mockResolvedValue(caller);
      const page = await OperationsPage();
      expect(isValidElement(page) && page.type).toBe(OpsAccessDenied);
      expect(mocks.recordOpsAccess).not.toHaveBeenCalled();
      expect(mocks.countExperiencesInReview).not.toHaveBeenCalled();
      expect(mocks.readRecentAuditForOps).not.toHaveBeenCalled();
    },
  );

  it('records the visit, then reads every count and five audit rows as the caller', async () => {
    mocks.readOpsCaller.mockResolvedValue(ops);
    await OperationsPage();
    expect(mocks.recordOpsAccess).toHaveBeenCalledWith(ops);
    for (const read of [
      mocks.countExperiencesInReview,
      mocks.countRefundFailedBookings,
      mocks.countOpenSupportRequests,
      mocks.countOpsPrivateRequests,
      mocks.countSessionsToday,
    ]) {
      expect(read).toHaveBeenCalledWith(ops);
    }
    expect(mocks.readRecentAuditForOps).toHaveBeenCalledWith(ops, 5);
  });

  it('puts each count in its own tile inside the landing, beside the areas', async () => {
    mocks.readOpsCaller.mockResolvedValue(ops);
    const page = await OperationsPage();
    if (!isValidElement<{ areas: unknown; children: unknown }>(page)) {
      throw new Error('expected an element');
    }
    expect(page.type).toBe(OpsLanding);
    expect(page.props.areas).toEqual(opsLandingLinks());
    const dashboard = page.props.children;
    if (
      !isValidElement<{
        tiles: { id: string; count: number }[];
      }>(dashboard)
    ) {
      throw new Error('expected the dashboard');
    }
    expect(dashboard.type).toBe(OpsDashboard);
    expect(dashboard.props.tiles.map((tile) => [tile.id, tile.count])).toEqual([
      ['inReview', 3],
      ['refundFailed', 1],
      ['openSupport', 12],
      ['privateRequests', 7],
      ['sessionsToday', 5],
    ]);
  });
});
