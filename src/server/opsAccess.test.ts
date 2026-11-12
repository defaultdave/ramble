import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readOpsCaller: vi.fn() }));

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
vi.mock('./opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));

import { opsCallerOrLeave } from './opsAccess';

// Behaviours under test:
// - the ops caller is returned as read
// - anyone else, admin included, is sent to the page it is given, and nothing is returned

beforeEach(() => {
  vi.resetAllMocks();
});

describe('opsCallerOrLeave', () => {
  it('returns the ops caller', async () => {
    const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
    mocks.readOpsCaller.mockResolvedValue(ops);

    await expect(opsCallerOrLeave('/ops/x')).resolves.toBe(ops);
  });

  it.each([
    ['an admin', { userId: 'u', roles: ['admin'], hostIds: [] }],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ])('sends %s to the page it is given', async (_who, caller) => {
    mocks.readOpsCaller.mockResolvedValue(caller);

    await expect(opsCallerOrLeave('/ops/x')).rejects.toMatchObject({
      href: '/ops/x',
    });
  });
});
