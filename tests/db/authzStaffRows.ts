import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/auth/caller';

// The staff-and-roles rows of the authorization matrix, kept apart so the matrix file stays under
// the size limit. Every function here is ops alone: admin is refused too. A person or row that is
// not there is answered with a result, never an error, so the guard is what the matrix sees.

const opsOnly = { platform: ['ops'] } as const;
const nobody = '00000000-0000-4000-8000-00000000dead';

/** The modules load when a row runs, not when the rows are built: they read DATABASE_URL, which the matrix's beforeAll sets. */
export function staffRows() {
  return [
    {
      fn: 'grantRole',
      invoke: async (c) =>
        (await import('@/server/db/staffRoles')).grantRole(c, nobody, {
          role: 'ops',
          hostId: null,
        }),
      allows: opsOnly,
    },
    {
      fn: 'revokeRole',
      invoke: async (c) =>
        (await import('@/server/db/staffRoles')).revokeRole(c, nobody, {
          role: 'ops',
          hostId: null,
        }),
      allows: opsOnly,
    },
    {
      fn: 'readStaffForOps',
      invoke: async (c) =>
        (await import('@/server/db/staffRoles')).readStaffForOps(c),
      allows: opsOnly,
    },
    {
      fn: 'readStaffInviteTarget',
      invoke: async (c) =>
        (await import('@/server/db/staffRoles')).readStaffInviteTarget(
          c,
          nobody,
        ),
      allows: opsOnly,
    },
    {
      fn: 'readAuditForOps',
      invoke: async (c) =>
        (await import('@/server/db/auditView')).readAuditForOps(
          c,
          '2026-01-05',
          0,
        ),
      allows: opsOnly,
    },
    {
      fn: 'inviteStaff',
      invoke: async (c) =>
        (await import('@/server/staffInvite')).inviteStaff(
          c,
          `matrix${randomUUID().replaceAll('-', '')}@example.com`,
        ),
      allows: opsOnly,
    },
    {
      fn: 'resendStaffLink',
      invoke: async (c) =>
        (await import('@/server/staffInvite')).resendStaffLink(c, nobody),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
