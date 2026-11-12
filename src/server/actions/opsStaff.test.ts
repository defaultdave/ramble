import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../../tests/support/ids';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  inviteStaff: vi.fn(),
  resendStaffLink: vi.fn(),
  revokeRole: vi.fn(),
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
vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/staffInvite', () => ({
  inviteStaff: mocks.inviteStaff,
  resendStaffLink: mocks.resendStaffLink,
}));
vi.mock('@/server/db/staffRoles', () => ({ revokeRole: mocks.revokeRole }));

import {
  inviteStaffAction,
  resendStaffLinkAction,
  revokeStaffAction,
} from './opsStaff';

// Behaviours under test, one per decision, branch or risk:
// - a caller without the ops role (an admin, nobody) is sent to the staff page and nothing is parsed, sent or removed
// - an invite with no address, or one that is not an address, goes back naming the email field and sends nothing
// - an invite sends the typed address, lower-cased, to the invite function as the ops caller, and says so after a fresh grant
// - a resend and a revoke with an id that is not an id go back to the staff page and call nothing
// - a resend sends to the person named and says what became of the link
// - a revoke removes the ops role, which names no host, and never admin, and says what became of it

const ops = { userId: id(1), roles: ['ops'], hostIds: [] };
const staffPage = '/ops/staff';

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
  mocks.readOpsCaller.mockResolvedValue(ops);
});

const actions = [
  ['invite', inviteStaffAction, { email: 'new@example.com' }],
  ['resend', resendStaffLinkAction, { userId: id(2) }],
  ['revoke', revokeStaffAction, { userId: id(2) }],
] as const;

describe.each(actions)(
  'the %s action without the ops role',
  (_name, action, fields) => {
    it.each([
      ['an admin', { userId: id(1), roles: ['admin'], hostIds: [] }],
      ['nobody', { userId: null, roles: [], hostIds: [] }],
    ])('sends %s to the staff page and does nothing', async (_who, caller) => {
      mocks.readOpsCaller.mockResolvedValue(caller);

      const href = await redirectOf(() => action(formOf(fields)));

      expect(href).toBe(staffPage);
      expect(mocks.inviteStaff).not.toHaveBeenCalled();
      expect(mocks.resendStaffLink).not.toHaveBeenCalled();
      expect(mocks.revokeRole).not.toHaveBeenCalled();
    });
  },
);

describe('inviteStaffAction', () => {
  it.each([[{}], [{ email: '   ' }], [{ email: 'not an address' }]])(
    'sends %j back naming the email field and sends nothing',
    async (fields) => {
      const href = await redirectOf(() => inviteStaffAction(formOf(fields)));

      expect(href).toBe(`${staffPage}?notice=invalid&fields=email`);
      expect(mocks.inviteStaff).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['sent', 'invited'],
    ['rate_limited', 'granted_rate_limited'],
    ['failed', 'granted_invite_failed'],
  ])('a link that is %s says %s', async (result, notice) => {
    mocks.inviteStaff.mockResolvedValue(result);

    const href = await redirectOf(() =>
      inviteStaffAction(formOf({ email: ' New@Example.com ' })),
    );

    expect(mocks.inviteStaff).toHaveBeenCalledWith(ops, 'new@example.com');
    expect(href).toBe(`${staffPage}?notice=${notice}`);
  });
});

describe('resendStaffLinkAction', () => {
  it.each([[{}], [{ userId: 'nope' }]])(
    'sends %j to the staff page and sends nothing',
    async (fields) => {
      const href = await redirectOf(() =>
        resendStaffLinkAction(formOf(fields)),
      );

      expect(href).toBe(staffPage);
      expect(mocks.resendStaffLink).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['sent', 'invited'],
    ['rate_limited', 'rate_limited'],
    ['failed', 'invite_failed'],
    ['not_found', 'not_found'],
  ])('a link that is %s says %s', async (result, notice) => {
    mocks.resendStaffLink.mockResolvedValue(result);

    const href = await redirectOf(() =>
      resendStaffLinkAction(formOf({ userId: id(2) })),
    );

    expect(mocks.resendStaffLink).toHaveBeenCalledWith(ops, id(2));
    expect(href).toBe(`${staffPage}?notice=${notice}`);
  });
});

describe('revokeStaffAction', () => {
  it.each([[{}], [{ userId: 'nope' }]])(
    'sends %j to the staff page and removes nothing',
    async (fields) => {
      const href = await redirectOf(() => revokeStaffAction(formOf(fields)));

      expect(href).toBe(staffPage);
      expect(mocks.revokeRole).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['revoked', 'revoked'],
    ['not_found', 'not_found'],
    ['self', 'revoke_self'],
    ['admin_role', 'revoke_refused'],
  ])(
    'removes only the ops role; a result of %s says %s',
    async (outcome, notice) => {
      mocks.revokeRole.mockResolvedValue(outcome);

      const href = await redirectOf(() =>
        revokeStaffAction(formOf({ userId: id(2), role: 'admin' })),
      );

      expect(mocks.revokeRole).toHaveBeenCalledWith(ops, id(2), {
        role: 'ops',
        hostId: null,
      });
      expect(href).toBe(`${staffPage}?notice=${notice}`);
    },
  );
});
