import { randomUUID } from 'node:crypto';
import { updateTag } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostSettingsInput } from '@/lib/hostSetup';
import {
  anonymousCaller,
  ForbiddenError,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { auditLog, hosts } from '@/server/db/schema';
import { client, parents, setupOrdersDatabase } from './orderFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, against the real database, one per decision, branch, or risk:
// - an owner reads their own host's settings; a host that is gone reads null
// - the owner of another host, host staff, a guest, ops, admin, and nobody are refused for a read and for a write, and a refused write changes nothing
// - a changed name and about text save in one transaction with one audit row naming the user and flagging the fields, never their text
// - a changed name or about text invalidates the host page and each of the host's experiences, after the commit
// - a changed notice address alone saves and is audited, and invalidates nothing: no guest sees it
// - values equal to the stored ones write nothing: no audit row, no invalidation
// - a blank about text and address save as null
// - the slug and time zone are never written
// - a host that is gone is not_found for a caller granted it, and writes nothing

setupOrdersDatabase();

let settings: typeof import('@/server/db/hostSettings');
const ownerId = randomUUID();
const owner = (hostId: string): Caller =>
  testCaller({ userId: ownerId, roles: [Role.HostOwner], hostIds: [hostId] });

beforeAll(async () => {
  settings = await import('@/server/db/hostSettings');
});

beforeEach(() => {
  vi.mocked(updateTag).mockClear();
});

const edit = (over: Partial<HostSettingsInput> = {}): HostSettingsInput => ({
  name: 'Renamed Host',
  description: 'About the host.',
  notificationEmail: 'bookings@example.com',
  ...over,
});

const hostRow = async () => {
  const [row] = await client.db
    .select()
    .from(hosts)
    .where(eq(hosts.id, parents.hostId));
  return row;
};

const auditRows = (hostId: string) =>
  client.db
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.subjectId, hostId), eq(auditLog.action, 'host.updated')),
    );

describe('refusals', () => {
  const refused: [string, () => Caller][] = [
    ['the owner of another host', () => owner(randomUUID())],
    [
      'host staff of this host',
      () =>
        testCaller({
          userId: ownerId,
          roles: [Role.HostStaff],
          hostIds: [parents.hostId],
        }),
    ],
    ['a guest', () => testCaller({ userId: ownerId })],
    ['ops', () => testCaller({ userId: ownerId, roles: [Role.Ops] })],
    ['admin', () => testCaller({ userId: ownerId, roles: [Role.Admin] })],
    ['nobody', () => anonymousCaller],
  ];

  it.each(refused)(
    'refuses %s for a read and for a write',
    async (_who, make) => {
      const before = await hostRow();
      await expect(
        settings.readHostSettings(make(), parents.hostId),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        settings.updateHostSettings(make(), parents.hostId, edit()),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await hostRow()).toEqual(before);
      expect(await auditRows(parents.hostId)).toHaveLength(0);
      expect(updateTag).not.toHaveBeenCalled();
    },
  );
});

describe('readHostSettings', () => {
  it('reads the owner their own host', async () => {
    expect(
      await settings.readHostSettings(owner(parents.hostId), parents.hostId),
    ).toEqual({ name: 'Host', description: null, notificationEmail: null });
  });

  it('reads null for a host that is gone', async () => {
    const gone = randomUUID();
    expect(await settings.readHostSettings(owner(gone), gone)).toBeNull();
  });
});

describe('updateHostSettings', () => {
  it('saves a new name and about text with one audit row and invalidates the guest pages', async () => {
    const result = await settings.updateHostSettings(
      owner(parents.hostId),
      parents.hostId,
      edit({ notificationEmail: null }),
    );
    expect(result).toBe('updated');
    expect(await hostRow()).toMatchObject({
      name: 'Renamed Host',
      description: 'About the host.',
      notificationEmail: null,
      slug: 'host-orders',
      timeZone: 'America/New_York',
    });
    const rows = await auditRows(parents.hostId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorKind: 'user',
      actorId: ownerId,
      subjectKind: 'host',
      details: { changed_name: true, changed_description: true },
    });
    expect(JSON.stringify(rows[0]?.details)).not.toContain('Renamed');
    expect(
      vi
        .mocked(updateTag)
        .mock.calls.map(([tag]) => tag)
        .sort(),
    ).toEqual(['catalog', `experience:${parents.experienceId}`].sort());
  });

  it('saves the notice address alone with an audit row and invalidates nothing', async () => {
    const result = await settings.updateHostSettings(
      owner(parents.hostId),
      parents.hostId,
      edit({ notificationEmail: 'new@example.com' }),
    );
    expect(result).toBe('updated');
    expect((await hostRow())?.notificationEmail).toBe('new@example.com');
    const rows = await auditRows(parents.hostId);
    expect(rows.at(-1)?.details).toEqual({ changed_notification_email: true });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('writes nothing when nothing differs', async () => {
    const stored = await hostRow();
    const before = (await auditRows(parents.hostId)).length;
    const result = await settings.updateHostSettings(
      owner(parents.hostId),
      parents.hostId,
      edit({ notificationEmail: 'new@example.com' }),
    );
    expect(result).toBe('unchanged');
    expect(await hostRow()).toEqual(stored);
    expect(await auditRows(parents.hostId)).toHaveLength(before);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('saves a blank about text and address as null', async () => {
    const result = await settings.updateHostSettings(
      owner(parents.hostId),
      parents.hostId,
      edit({ description: null, notificationEmail: null }),
    );
    expect(result).toBe('updated');
    expect(await hostRow()).toMatchObject({
      description: null,
      notificationEmail: null,
    });
  });

  it('is not_found for a host that is gone, writing nothing', async () => {
    const gone = randomUUID();
    expect(await settings.updateHostSettings(owner(gone), gone, edit())).toBe(
      'not_found',
    );
    expect(await auditRows(gone)).toHaveLength(0);
    expect(updateTag).not.toHaveBeenCalled();
  });
});
