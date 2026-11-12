import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../tests/support/ids';

const mocks = vi.hoisted(() => ({ getCaller: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/server/auth/caller', () => ({ getCaller: mocks.getCaller }));

import { loadForHostArea } from './hostArea';

// Behaviours under test, one per decision, branch or risk:
// - an owner's host is read, whether or not the page allows staff
// - host staff trigger no read unless the page allows staff, and then their host is read
// - nobody signed in, and a caller with no host role, never trigger a read
// - the page's decision gets the access and what was read, or null when nothing was read

const caller = (hostGrants: { role: string; hostId: string }[]) => ({
  userId: id(1),
  roles: [],
  hostIds: [],
  hostGrants,
});
const owner = caller([{ role: 'host_owner', hostId: id(2) }]);
const staff = caller([{ role: 'host_staff', hostId: id(2) }]);

const read = vi.fn();
const decide = vi.fn((access: unknown, data: unknown) => ({ access, data }));

beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue('rows');
  decide.mockImplementation((access, data) => ({ access, data }));
});

describe('loadForHostArea', () => {
  it.each([false, true])(
    'reads an owner’s own host (allowStaff %s)',
    async (allowStaff) => {
      mocks.getCaller.mockResolvedValue(owner);
      const result = await loadForHostArea(read, decide, allowStaff);
      expect(read).toHaveBeenCalledWith(owner, id(2));
      expect(result).toEqual({
        access: { kind: 'owner', hostId: id(2) },
        data: 'rows',
      });
    },
  );

  it('does not read for host staff unless the page allows staff', async () => {
    mocks.getCaller.mockResolvedValue(staff);
    const result = await loadForHostArea(read, decide);
    expect(read).not.toHaveBeenCalled();
    expect(result).toEqual({
      access: { kind: 'staff', hostId: id(2) },
      data: null,
    });
  });

  it('reads the staffed host when the page allows staff', async () => {
    mocks.getCaller.mockResolvedValue(staff);
    await loadForHostArea(read, decide, true);
    expect(read).toHaveBeenCalledWith(staff, id(2));
  });

  it.each([
    ['nobody signed in', { userId: null, roles: [], hostIds: [] }],
    ['a caller with no host role', caller([])],
  ])('never reads for %s', async (_who, given) => {
    mocks.getCaller.mockResolvedValue(given);
    await loadForHostArea(read, decide, true);
    expect(read).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledWith(expect.anything(), null);
  });
});
