import { beforeEach, describe, expect, it, vi } from 'vitest';
import { id } from '../../tests/support/ids';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';

const mocks = vi.hoisted(() => ({
  requireHostOwnerId: vi.fn(),
  grantHostStaff: vi.fn(),
  readHostStaffAddress: vi.fn(),
  consumeRateLimit: vi.fn(),
  sendStaffLink: vi.fn(),
}));

vi.mock('@/server/db/staffRoles', () => ({
  requireHostOwnerId: mocks.requireHostOwnerId,
  grantHostStaff: mocks.grantHostStaff,
  readHostStaffAddress: mocks.readHostStaffAddress,
}));
vi.mock('@/server/ports/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock('./staffInvite', () => ({ sendStaffLink: mocks.sendStaffLink }));

import { inviteHostStaff, resendHostStaffLink } from './hostStaffInvite';

// Behaviours under test, one per decision, branch or risk:
// - an owner over the invite rate gets too_many_invites, and nothing is granted or sent
// - a host at its cap gets cap_reached, and no link is sent
// - a grant sends the lower-cased address one link to the host's landing page, as the owner
// - a person who is not this host's staff is not found by a resend, and nothing is sent
// - the owner check runs first: a caller who is refused spends no rate and reads nothing

const hostId = id(9);
const caller = testCaller({
  userId: id(1),
  roles: [Role.HostOwner],
  hostIds: [hostId],
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireHostOwnerId.mockReturnValue(id(1));
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
});

describe('inviteHostStaff', () => {
  it('stops an owner over the invite rate before granting', async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false });

    expect(await inviteHostStaff(caller, hostId, 'new@example.com')).toBe(
      'too_many_invites',
    );

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      'host_staff_invite',
      id(1),
    );
    expect(mocks.grantHostStaff).not.toHaveBeenCalled();
    expect(mocks.sendStaffLink).not.toHaveBeenCalled();
  });

  it('sends no link when the host is at its cap', async () => {
    mocks.grantHostStaff.mockResolvedValue('cap_reached');

    expect(await inviteHostStaff(caller, hostId, 'new@example.com')).toBe(
      'cap_reached',
    );

    expect(mocks.sendStaffLink).not.toHaveBeenCalled();
  });

  it('sends one link to the lower-cased address, as the owner, to the host area', async () => {
    mocks.grantHostStaff.mockResolvedValue({
      userId: id(2),
      outcome: 'granted',
    });
    mocks.sendStaffLink.mockResolvedValue('sent');

    expect(await inviteHostStaff(caller, hostId, 'New@Example.com')).toBe(
      'sent',
    );

    expect(mocks.grantHostStaff).toHaveBeenCalledWith(
      caller,
      hostId,
      'new@example.com',
    );
    expect(mocks.sendStaffLink).toHaveBeenCalledWith(
      id(1),
      id(2),
      'new@example.com',
      expect.objectContaining({ landingPath: '/host' }),
    );
  });

  it('refuses a caller who does not own the host before spending the rate', async () => {
    mocks.requireHostOwnerId.mockImplementation(() => {
      throw new Error('refused');
    });

    await expect(
      inviteHostStaff(caller, hostId, 'new@example.com'),
    ).rejects.toThrow('refused');

    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.grantHostStaff).not.toHaveBeenCalled();
  });
});

describe('resendHostStaffLink', () => {
  it('finds nobody for a person who is not this host’s staff, and sends nothing', async () => {
    mocks.readHostStaffAddress.mockResolvedValue(null);

    expect(await resendHostStaffLink(caller, hostId, id(2))).toBe('not_found');

    expect(mocks.sendStaffLink).not.toHaveBeenCalled();
  });

  it('sends the staff member a link', async () => {
    mocks.readHostStaffAddress.mockResolvedValue('staff@example.com');
    mocks.sendStaffLink.mockResolvedValue('sent');

    expect(await resendHostStaffLink(caller, hostId, id(2))).toBe('sent');

    expect(mocks.sendStaffLink).toHaveBeenCalledWith(
      id(1),
      id(2),
      'staff@example.com',
      expect.objectContaining({ keyPrefix: 'host-staff-link' }),
    );
  });
});
