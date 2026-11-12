import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/auth/caller';
import type { Subject } from './authzFixtures';

// The host-staff rows of the authorization matrix, kept apart so the matrix file stays under the
// size limit. Every function here admits the owner of the host and nobody else: not host staff
// (who read the host and change nothing), not the other host's owner, not ops, not admin. A host
// that is not there is refused to everyone, so the answer does not say which hosts exist.

const ownerOnly = {
  hostA: ['ownerA'],
  hostB: ['ownerB'],
  missing: [],
} as const satisfies Record<string, readonly Subject[]>;

/** The host's owner and staff read it; every other write or read stays the owner's. The functions below are the only ones that admit host staff. */
export const hostReaders = {
  hostA: ['ownerA', 'staffA'],
  hostB: ['ownerB', 'staffB'],
  missing: [],
} as const satisfies Record<string, readonly Subject[]>;

export const hostReaderFunctions = [
  'readHostDashboard',
  'readHostWeek',
  'readHostBookings',
  'readHostGuestList',
];

const nobody = '00000000-0000-4000-8000-00000000dead';
const freshAddress = () =>
  `matrix${randomUUID().replaceAll('-', '')}@example.com`;

/** The modules load when a row runs, not when the rows are built: they read DATABASE_URL, which the matrix's beforeAll sets. */
export function hostStaffRows() {
  return [
    {
      fn: 'requireHostOwnerId',
      invoke: async (c, t) =>
        (await import('@/server/db/staffRoles')).requireHostOwnerId(
          c,
          t.hostId,
        ),
      allows: ownerOnly,
    },
    {
      fn: 'grantHostStaff',
      invoke: async (c, t) =>
        (await import('@/server/db/staffRoles')).grantHostStaff(
          c,
          t.hostId,
          freshAddress(),
        ),
      allows: ownerOnly,
    },
    {
      fn: 'revokeHostStaff',
      invoke: async (c, t) =>
        (await import('@/server/db/staffRoles')).revokeHostStaff(
          c,
          t.hostId,
          nobody,
        ),
      allows: ownerOnly,
    },
    {
      fn: 'readHostStaff',
      invoke: async (c, t) =>
        (await import('@/server/db/staffRoles')).readHostStaff(c, t.hostId),
      allows: ownerOnly,
    },
    {
      fn: 'readHostStaffAddress',
      invoke: async (c, t) =>
        (await import('@/server/db/staffRoles')).readHostStaffAddress(
          c,
          t.hostId,
          nobody,
        ),
      allows: ownerOnly,
    },
    {
      fn: 'inviteHostStaff',
      invoke: async (c, t) =>
        (await import('@/server/hostStaffInvite')).inviteHostStaff(
          c,
          t.hostId,
          freshAddress(),
        ),
      allows: ownerOnly,
    },
    {
      fn: 'resendHostStaffLink',
      invoke: async (c, t) =>
        (await import('@/server/hostStaffInvite')).resendHostStaffLink(
          c,
          t.hostId,
          nobody,
        ),
      allows: ownerOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller, target: { hostId: string }) => Promise<unknown>;
    allows: Record<string, readonly Subject[]>;
  }[];
}
