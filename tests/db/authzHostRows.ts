import { randomUUID } from 'node:crypto';
import type { Caller } from '@/server/auth/caller';

// The host-setup rows of the authorization matrix, kept apart so the matrix file stays under the size limit.
// Every function here is ops alone. A missing host answers not found to ops and is refused to everyone else.

type Target = { hostId: string };

const opsOnly = { platform: ['ops'] } as const;

/** The modules load when a row runs, not when the rows are built: they read DATABASE_URL, which the matrix's beforeAll sets. */
export function hostSetupRows() {
  return [
    {
      fn: 'createHost',
      invoke: async (c) => {
        const unique = randomUUID().replaceAll('-', '');
        return (await import('@/server/db/hostSetup')).createHost(c, {
          name: `Matrix host ${unique}`,
          slug: `matrix-${unique}`,
          description: null,
          timeZone: 'America/New_York',
          notificationEmail: null,
          ownerEmail: `owner${unique}@example.com`,
          acceptedLegalDocumentId: null,
        });
      },
      allows: opsOnly,
    },
    {
      fn: 'updateHost',
      invoke: async (c, t) =>
        (await import('@/server/db/hostSetup')).updateHost(c, t.hostId, {
          name: 'Renamed',
          slug: 'renamed',
          description: null,
          timeZone: 'UTC',
          notificationEmail: null,
        }),
      allows: opsOnly,
    },
    {
      fn: 'readHostsForOps',
      invoke: async (c) =>
        (await import('@/server/db/hostSetup')).readHostsForOps(c, null),
      allows: opsOnly,
    },
    {
      fn: 'readHostForOps',
      invoke: async (c, t) =>
        (await import('@/server/db/hostSetup')).readHostForOps(c, t.hostId),
      allows: opsOnly,
    },
    {
      fn: 'readNewHostForm',
      invoke: async (c) =>
        (await import('@/server/db/hostSetup')).readNewHostForm(c),
      allows: opsOnly,
    },
    {
      fn: 'readHostInviteTarget',
      invoke: async (c, t) =>
        (await import('@/server/db/hostSetup')).readHostInviteTarget(
          c,
          t.hostId,
          randomUUID(),
        ),
      allows: opsOnly,
    },
    {
      fn: 'recordHostAcceptance',
      invoke: async (c, t) =>
        (await import('@/server/db/legal')).recordHostAcceptance(
          c,
          t.hostId,
          randomUUID(),
        ),
      allows: opsOnly,
    },
    {
      fn: 'readHostAcceptances',
      invoke: async (c, t) =>
        (await import('@/server/db/legal')).readHostAcceptances(c, [t.hostId]),
      allows: opsOnly,
    },
    {
      fn: 'inviteHostOwner',
      invoke: async (c, t) =>
        (await import('@/server/hostInvite')).inviteHostOwner(
          c,
          t.hostId,
          randomUUID(),
        ),
      allows: opsOnly,
    },
  ] satisfies {
    fn: string;
    invoke: (caller: Caller, target: Target) => Promise<unknown>;
    allows: { platform: readonly string[] };
  }[];
}
