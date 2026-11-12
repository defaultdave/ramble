import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  getCaller: vi.fn(),
  inviteHostStaff: vi.fn(),
  resendHostStaffLink: vi.fn(),
  revokeHostStaff: vi.fn(),
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
vi.mock('@/server/auth/caller', () => ({ getCaller: mocks.getCaller }));
vi.mock('@/server/hostStaffInvite', () => ({
  inviteHostStaff: mocks.inviteHostStaff,
  resendHostStaffLink: mocks.resendHostStaffLink,
}));
vi.mock('@/server/db/staffRoles', () => ({
  revokeHostStaff: mocks.revokeHostStaff,
}));

import {
  inviteHostStaffAction,
  resendHostStaffLinkAction,
  revokeHostStaffAction,
} from './hostStaff';

// Behaviours under test, one per decision, branch or risk:
// - nobody signed in, a guest, and host staff are sent to the host's home and nothing is parsed, sent or removed
// - an invite with no address, or one that is not an address, goes back naming the email field and sends nothing
// - an invite sends the typed address, lower-cased, for the host the caller owns, and says so after a fresh grant
// - a resend and a revoke with an id that is not an id go back to the staff page and call nothing
// - a resend and a revoke act for the host in the caller's own grant, never one named in the form, and say what became of them

const hostId = id(9);
const owner = {
  userId: id(1),
  roles: ['guest', 'host_owner'],
  hostIds: [hostId],
  hostGrants: [{ role: 'host_owner', hostId }],
};
const staffPage = '/host/staff';

function formOf(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectOf(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Redirected) return error.href;
    throw error;
  }
  throw new Error('The action did not redirect');
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCaller.mockResolvedValue(owner);
});

const actions = [
  ['invite', inviteHostStaffAction, { email: 'new@example.com' }],
  ['resend', resendHostStaffLinkAction, { userId: id(2) }],
  ['revoke', revokeHostStaffAction, { userId: id(2) }],
] as const;

describe.each(actions)(
  'the %s action without owning a host',
  (_name, action, fields) => {
    it.each([
      ['nobody', { userId: null, roles: [], hostIds: [] }],
      ['a guest', { userId: id(3), roles: ['guest'], hostIds: [] }],
      [
        'host staff',
        {
          userId: id(4),
          roles: ['guest', 'host_staff'],
          hostIds: [hostId],
          hostGrants: [{ role: 'host_staff', hostId }],
        },
      ],
    ])('sends %s to the host home and does nothing', async (_who, caller) => {
      mocks.getCaller.mockResolvedValue(caller);

      const href = await redirectOf(() => action(formOf(fields)));

      expect(href).toBe('/host');
      expect(mocks.inviteHostStaff).not.toHaveBeenCalled();
      expect(mocks.resendHostStaffLink).not.toHaveBeenCalled();
      expect(mocks.revokeHostStaff).not.toHaveBeenCalled();
    });
  },
);

describe('inviteHostStaffAction', () => {
  it.each([[{}], [{ email: '   ' }], [{ email: 'not an address' }]])(
    'sends %j back naming the email field and sends nothing',
    async (fields) => {
      const href = await redirectOf(() =>
        inviteHostStaffAction(formOf(fields)),
      );

      expect(href).toBe(`${staffPage}?notice=invalid&fields=email`);
      expect(mocks.inviteHostStaff).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['sent', 'invited'],
    ['rate_limited', 'granted_rate_limited'],
    ['failed', 'granted_invite_failed'],
    ['cap_reached', 'staff_cap'],
    ['too_many_invites', 'invites_limited'],
  ])('a result of %s says %s', async (result, notice) => {
    mocks.inviteHostStaff.mockResolvedValue(result);

    const href = await redirectOf(() =>
      inviteHostStaffAction(formOf({ email: ' New@Example.com ' })),
    );

    expect(mocks.inviteHostStaff).toHaveBeenCalledWith(
      owner,
      hostId,
      'new@example.com',
    );
    expect(href).toBe(`${staffPage}?notice=${notice}`);
  });
});

describe('resendHostStaffLinkAction', () => {
  it.each([[{}], [{ userId: 'nope' }]])(
    'sends %j to the staff page and sends nothing',
    async (fields) => {
      const href = await redirectOf(() =>
        resendHostStaffLinkAction(formOf(fields)),
      );

      expect(href).toBe(staffPage);
      expect(mocks.resendHostStaffLink).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['sent', 'invited'],
    ['rate_limited', 'rate_limited'],
    ['failed', 'invite_failed'],
    ['not_found', 'not_found'],
  ])('a link that is %s says %s', async (result, notice) => {
    mocks.resendHostStaffLink.mockResolvedValue(result);

    const href = await redirectOf(() =>
      resendHostStaffLinkAction(formOf({ userId: id(2), hostId: id(77) })),
    );

    expect(mocks.resendHostStaffLink).toHaveBeenCalledWith(
      owner,
      hostId,
      id(2),
    );
    expect(href).toBe(`${staffPage}?notice=${notice}`);
  });
});

describe('revokeHostStaffAction', () => {
  it.each([[{}], [{ userId: 'nope' }]])(
    'sends %j to the staff page and removes nothing',
    async (fields) => {
      const href = await redirectOf(() =>
        revokeHostStaffAction(formOf(fields)),
      );

      expect(href).toBe(staffPage);
      expect(mocks.revokeHostStaff).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['revoked', 'revoked'],
    ['not_found', 'not_found'],
  ])('an outcome of %s says %s', async (outcome, notice) => {
    mocks.revokeHostStaff.mockResolvedValue(outcome);

    const href = await redirectOf(() =>
      revokeHostStaffAction(formOf({ userId: id(2), hostId: id(77) })),
    );

    expect(mocks.revokeHostStaff).toHaveBeenCalledWith(owner, hostId, id(2));
    expect(href).toBe(`${staffPage}?notice=${notice}`);
  });
});
