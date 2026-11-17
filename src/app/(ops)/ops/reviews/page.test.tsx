import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  readReviewsForModeration: vi.fn(),
}));

vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/db/reviewModeration', () => ({
  readReviewsForModeration: mocks.readReviewsForModeration,
}));
vi.mock('@/server/actions/opsReviews', () => ({
  hideReviewAction: vi.fn(),
  unhideReviewAction: vi.fn(),
}));

import { OpsAccessDenied } from '@/components/OpsShell';
import ReviewModerationPage from './page';

// Behaviours under test:
// - a caller without the ops role (a guest, an admin, nobody) gets the access-denied view and no review is read
// - an ops caller reads the reviews with the status and cursor the address names

const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const cursor = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readReviewsForModeration.mockResolvedValue({
    rows: [],
    nextCursor: null,
  });
});

describe('the guest reviews page', () => {
  it.each([
    ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
    ['an admin', { userId: 'a', roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])(
    'shows %s the access-denied view and reads nothing',
    async (_who, caller) => {
      mocks.readOpsCaller.mockResolvedValue(caller);
      const page = await ReviewModerationPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({}),
      });
      expect(isValidElement(page) && page.type).toBe(OpsAccessDenied);
      expect(mocks.readReviewsForModeration).not.toHaveBeenCalled();
    },
  );

  it('reads the reviews for ops by the status and cursor in the address', async () => {
    mocks.readOpsCaller.mockResolvedValue(ops);
    await ReviewModerationPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ status: 'hidden', cursor }),
    });
    expect(mocks.readReviewsForModeration).toHaveBeenCalledWith(ops, {
      status: 'hidden',
      cursor,
    });
  });
});
