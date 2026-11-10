import { describe, expect, it } from 'vitest';
import {
  hostAccessFor,
  hostDashboardResult,
  type HostAccessInput,
} from './hostAccess';

// Behaviours under test, one per decision, branch or risk:
// - nobody signed in is told to sign in
// - a guest, ops, admin, and host staff are signed in but own no host
// - an owner gets the host they own, from their grants and nowhere else
// - owner of one host and staff of another gets the owned host, not the staffed one
// - an owner of several hosts gets the first granted
// - the page's outcome: sign in for nobody, refused for a non-owner or a missing host, the view for an owner with data

const hostA = '00000000-0000-4000-8000-00000000000a';
const hostB = '00000000-0000-4000-8000-00000000000b';

const signedIn = (
  hostGrants?: HostAccessInput['hostGrants'],
): HostAccessInput => ({ userId: 'user-1', hostGrants });

describe('hostAccessFor', () => {
  it('signs out nobody', () => {
    expect(hostAccessFor({ userId: null, hostGrants: [] })).toEqual({
      kind: 'signed_out',
    });
  });

  it.each([
    ['a guest, ops, or admin', signedIn([])],
    ['a caller with no grants listed', signedIn()],
    ['host staff', signedIn([{ role: 'host_staff', hostId: hostA }])],
  ])('owns no host for %s', (_name, caller) => {
    expect(hostAccessFor(caller)).toEqual({ kind: 'not_a_host_owner' });
  });

  it('gives an owner their host', () => {
    expect(
      hostAccessFor(signedIn([{ role: 'host_owner', hostId: hostA }])),
    ).toEqual({ kind: 'owner', hostId: hostA });
  });

  it('gives the owned host to someone who owns one and is staff on another', () => {
    expect(
      hostAccessFor(
        signedIn([
          { role: 'host_staff', hostId: hostA },
          { role: 'host_owner', hostId: hostB },
        ]),
      ),
    ).toEqual({ kind: 'owner', hostId: hostB });
  });

  it('gives the first granted of several owned hosts', () => {
    expect(
      hostAccessFor(
        signedIn([
          { role: 'host_owner', hostId: hostB },
          { role: 'host_owner', hostId: hostA },
        ]),
      ),
    ).toEqual({ kind: 'owner', hostId: hostB });
  });
});

describe('hostDashboardResult', () => {
  const data = { hostName: 'Harbor Co', sessions: [], bookings: [] };

  it('sends nobody signed in to sign in, with or without data', () => {
    expect(hostDashboardResult({ kind: 'signed_out' }, null)).toEqual({
      status: 'signed_out',
    });
  });

  it.each([
    [
      'a non-owner, even with data',
      { kind: 'not_a_host_owner' } as const,
      data,
    ],
    [
      'an owner whose host is gone',
      { kind: 'owner', hostId: hostA } as const,
      null,
    ],
  ])('refuses %s', (_name, access, given) => {
    expect(hostDashboardResult(access, given)).toEqual({ status: 'refused' });
  });

  it('builds the view for an owner with data', () => {
    expect(hostDashboardResult({ kind: 'owner', hostId: hostA }, data)).toEqual(
      {
        status: 'ok',
        view: { hostName: 'Harbor Co', sessions: [], bookings: [] },
      },
    );
  });
});
