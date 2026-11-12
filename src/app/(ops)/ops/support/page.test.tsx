import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  readSupportQueue: vi.fn(),
}));

vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/db/supportQueue', () => ({
  readSupportQueue: mocks.readSupportQueue,
}));
vi.mock('@/server/actions/opsSupport', () => ({
  resolveSupportRequestAction: vi.fn(),
}));

import { OpsAccessDenied } from '@/components/OpsShell';
import SupportPage from './page';

// Behaviours under test:
// - a caller without the ops role (a guest, an admin, nobody) gets the access-denied view and the queue is never read
// - an ops caller reads the queue with the status and cursor the address names

const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const cursor = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSupportQueue.mockResolvedValue({ rows: [], nextCursor: null });
});

describe('the support page', () => {
  it.each([
    ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
    ['an admin', { userId: 'a', roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])(
    'shows %s the access-denied view and reads nothing',
    async (_who, caller) => {
      mocks.readOpsCaller.mockResolvedValue(caller);
      const page = await SupportPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({}),
      });
      expect(isValidElement(page) && page.type).toBe(OpsAccessDenied);
      expect(mocks.readSupportQueue).not.toHaveBeenCalled();
    },
  );

  it('reads the queue for ops by the status and cursor in the address', async () => {
    mocks.readOpsCaller.mockResolvedValue(ops);
    await SupportPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ status: 'open', cursor }),
    });
    expect(mocks.readSupportQueue).toHaveBeenCalledWith(ops, {
      status: 'open',
      cursor,
    });
  });
});
