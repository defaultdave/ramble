import { describe, expect, it } from 'vitest';
import { anonymousCaller, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { hostAccessFor } from './hostAccess';

// Behaviours under test, one per decision, branch or risk:
// - nobody signed in is told to sign in
// - a guest, ops, admin, and host staff are signed in but own no host
// - an owner gets the host they own, from their grants and nowhere else
// - owner of one host and staff of another gets the owned host, not the staffed one
// - an owner of several hosts gets the first granted

const hostA = '00000000-0000-4000-8000-00000000000a';
const hostB = '00000000-0000-4000-8000-00000000000b';

describe('hostAccessFor', () => {
  it('signs out nobody', () => {
    expect(hostAccessFor(anonymousCaller)).toEqual({ kind: 'signed_out' });
  });

  it.each([
    ['a guest', testCaller()],
    ['ops', testCaller({ roles: [Role.Ops] })],
    ['admin', testCaller({ roles: [Role.Admin] })],
    ['host staff', testCaller({ roles: [Role.HostStaff], hostIds: [hostA] })],
  ])('owns no host for %s', (_name, caller) => {
    expect(hostAccessFor(caller)).toEqual({ kind: 'not_a_host_owner' });
  });

  it('gives an owner their host', () => {
    expect(
      hostAccessFor(testCaller({ roles: [Role.HostOwner], hostIds: [hostA] })),
    ).toEqual({ kind: 'owner', hostId: hostA });
  });

  it('gives the owned host to someone who owns one and is staff on another', () => {
    const caller = testCaller({
      roles: [Role.HostOwner, Role.HostStaff],
      hostIds: [hostA, hostB],
      hostGrants: [
        { role: 'host_staff', hostId: hostA },
        { role: 'host_owner', hostId: hostB },
      ],
    });
    expect(hostAccessFor(caller)).toEqual({ kind: 'owner', hostId: hostB });
  });

  it('gives the first granted of several owned hosts', () => {
    const caller = testCaller({
      roles: [Role.HostOwner],
      hostIds: [hostB, hostA],
    });
    expect(hostAccessFor(caller)).toEqual({ kind: 'owner', hostId: hostB });
  });
});
