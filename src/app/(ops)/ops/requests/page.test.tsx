import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  readOpsPrivateRequests: vi.fn(),
}));

vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/db/privateRequests', () => ({
  readOpsPrivateRequests: mocks.readOpsPrivateRequests,
}));

import { OpsAccessDenied } from '@/components/OpsShell';
import PrivateRequestsPage from './page';

// Behaviours under test:
// - a caller without the ops role (a guest, an admin, nobody) gets the access-denied view and the queue is never read
// - an ops caller reads the queue with the cursor the address names
// - a cursor that is not an id is read as the first page

const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const cursor = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

const render = (searchParams: Record<string, string>) =>
  PrivateRequestsPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readOpsPrivateRequests.mockResolvedValue({
    rows: [],
    nextCursor: null,
  });
});

describe('the private requests page', () => {
  it.each([
    ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
    ['an admin', { userId: 'a', roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])(
    'shows %s the access-denied view and reads nothing',
    async (_who, caller) => {
      mocks.readOpsCaller.mockResolvedValue(caller);
      const page = await render({});
      expect(isValidElement(page) && page.type).toBe(OpsAccessDenied);
      expect(mocks.readOpsPrivateRequests).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a cursor id', cursor, cursor],
    ['a cursor that is not an id', 'not-an-id', null],
  ])('reads the queue for ops with %s', async (_what, given, expected) => {
    mocks.readOpsCaller.mockResolvedValue(ops);
    await render({ cursor: given });
    expect(mocks.readOpsPrivateRequests).toHaveBeenCalledWith(ops, {
      cursor: expected,
    });
  });
});
