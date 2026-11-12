import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  opsCallerOrLeave: vi.fn(),
  resolveSupportRequest: vi.fn(),
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
vi.mock('@/server/db/supportQueue', () => ({
  resolveSupportRequest: mocks.resolveSupportRequest,
}));

import { resolveSupportRequestAction } from './opsSupport';

// Behaviours under test:
// - the caller is checked first: a caller sent away reads nothing and resolves nothing
// - a refused form redirects with the invalid notice and resolves nothing
// - a resolved or already resolved request redirects with that notice; a missing one redirects to the bare queue
// - the id and note reach the data layer as parsed, with the ops caller

const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const ops = { userId: 'u', roles: ['ops'], hostIds: [] };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.opsCallerOrLeave.mockResolvedValue(ops);
});

describe('resolveSupportRequestAction', () => {
  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/support'));
    await expect(
      resolveSupportRequestAction(form({ id, note: 'Done.' })),
    ).rejects.toMatchObject({ href: '/ops/support' });
    expect(mocks.resolveSupportRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank note', { id, note: ' ' }],
    ['no id', { note: 'Done.' }],
  ])('redirects with the invalid notice for %s', async (_name, fields) => {
    await expect(
      resolveSupportRequestAction(form(fields)),
    ).rejects.toMatchObject({
      href: '/ops/support?notice=invalid',
    });
    expect(mocks.resolveSupportRequest).not.toHaveBeenCalled();
  });

  it.each(['resolved', 'already_resolved'])(
    'redirects with the %s notice',
    async (outcome) => {
      mocks.resolveSupportRequest.mockResolvedValue(outcome);
      await expect(
        resolveSupportRequestAction(form({ id, note: 'Done.' })),
      ).rejects.toMatchObject({
        href: `/ops/support?notice=${outcome}`,
      });
      expect(mocks.resolveSupportRequest).toHaveBeenCalledWith(ops, {
        id,
        note: 'Done.',
      });
    },
  );

  it('redirects to the bare queue for a request that is not there', async () => {
    mocks.resolveSupportRequest.mockResolvedValue('not_found');
    await expect(
      resolveSupportRequestAction(form({ id, note: 'Done.' })),
    ).rejects.toMatchObject({ href: '/ops/support' });
  });
});
