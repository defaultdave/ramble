import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { guestVisibleStatuses } from '@/lib/catalog';
import { tags } from '@/lib/cacheTags';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { experiences } from '@/server/db/schema';
import { catalogFixtures } from './catalogFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

const cache = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock('next/cache', () => ({
  updateTag: cache.updateTag,
  revalidateTag: vi.fn(),
}));

// Behaviours under test, against the real database, one per decision, branch or risk:
// Access:
// - a guest, a host owner, an admin and nobody are refused with ForbiddenError, and nothing changes
// One experience:
// - a live experience is paused with one audit row naming the ops user, and its listing tags are invalidated after the commit
// - a paused experience is unpaused the same way, and is guest visible again
// - a paused experience is not guest visible
// - an experience in any other status is refused (not_live, not_paused): nothing changes, no audit row, nothing invalidated
// - an id that is no experience, or no id, is not_found
// - two pauses at once: one wins, the other finds it no longer live, and one audit row is written
// A host:
// - suspending pauses every live experience of that host, one audit row each and one for the host with the count, leaving drafts, paused ones and other hosts' experiences alone
// - the tags of every paused listing are invalidated
// - a host with no live experience, or no host, changes nothing
// - unsuspending unpauses only the experiences a suspension paused: not one paused by hand, one paused with no audit row, or one a suspension paused and ops then unpaused and paused by hand
// - an experience a suspension paused and ops unpaused by hand is not touched by a later unsuspend
// - the counts the host page shows follow the live and suspension-paused experiences

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let pause: typeof import('@/server/db/experiencePause');
let fixtures: ReturnType<typeof catalogFixtures>;

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });

const refused: [string, Caller][] = [
  ['a guest', testCaller({ userId: randomUUID() })],
  [
    'a host owner',
    testCaller({
      userId: randomUUID(),
      roles: [Role.HostOwner],
      hostIds: [randomUUID()],
    }),
  ],
  ['an admin', testCaller({ userId: randomUUID(), roles: [Role.Admin] })],
  ['nobody', { userId: null, roles: [], hostIds: [] }],
];

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  pause = await import('@/server/db/experiencePause');
  fixtures = catalogFixtures(() => client.db);
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  cache.updateTag.mockClear();
});

type Status = 'live' | 'paused' | 'draft' | 'in_review';

/** An experience in `status`, on a new host or the host given, with the slugs its tags are built from. */
async function experienceOf(status: Status, hostId?: string) {
  const parents = await fixtures.parents(hostId);
  const row = await fixtures.insertExperience(parents, { status });
  const [category, neighborhood] = await Promise.all([
    client.db.query.categories.findFirst({
      where: (t, { eq: is }) => is(t.id, parents.categoryId),
    }),
    client.db.query.neighborhoods.findFirst({
      where: (t, { eq: is }) => is(t.id, parents.neighborhoodId),
    }),
  ]);
  return {
    id: row.id,
    hostId: parents.hostId,
    categorySlug: category?.slug ?? '',
    neighborhoodSlug: neighborhood?.slug ?? '',
  };
}

async function statusOf(experienceId: string) {
  const [row] = await client.db
    .select({ status: experiences.status })
    .from(experiences)
    .where(eq(experiences.id, experienceId));
  return row?.status;
}

async function auditRows(subjectId: string) {
  const { rows } = await client.db.execute<{
    action: string;
    actor_id: string | null;
    details: Record<string, unknown>;
  }>(
    sql`SELECT action, actor_id, details FROM audit_log WHERE subject_id = ${subjectId} ORDER BY id`,
  );
  return rows;
}

const invalidated = () =>
  cache.updateTag.mock.calls.map(([tag]) => tag as string);

const pausedBy = (viaHostSuspension: boolean) => ({
  action: 'experience.paused',
  actor_id: opsUser,
  details: {
    from_status: 'live',
    to_status: 'paused',
    via_host_suspension: viaHostSuspension,
  },
});
const unpausedBy = (viaHostSuspension: boolean) => ({
  action: 'experience.unpaused',
  actor_id: opsUser,
  details: {
    from_status: 'paused',
    to_status: 'live',
    via_host_suspension: viaHostSuspension,
  },
});

describe('access', () => {
  it.each(refused)('refuses %s and changes nothing', async (_who, caller) => {
    const target = await experienceOf('live');

    await expect(
      pause.setExperiencePaused(caller, target.id, 'pause'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      pause.setHostSuspended(caller, target.hostId, 'pause'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      pause.readHostSuspension(caller, target.hostId),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await statusOf(target.id)).toBe('live');
    expect(await auditRows(target.id)).toEqual([]);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });
});

describe('one experience', () => {
  it('pauses a live experience with one audit row, and invalidates its listing tags', async () => {
    const target = await experienceOf('live');

    expect(await pause.setExperiencePaused(ops, target.id, 'pause')).toEqual({
      status: 'paused',
    });

    expect(await statusOf(target.id)).toBe('paused');
    expect(await auditRows(target.id)).toEqual([pausedBy(false)]);
    expect(invalidated()).toEqual(
      expect.arrayContaining([
        tags.experience(target.id),
        tags.catalog,
        tags.category(target.categorySlug),
        tags.neighborhood(target.neighborhoodSlug),
      ]),
    );
  });

  it('unpauses a paused experience with one audit row, and invalidates its listing tags', async () => {
    const target = await experienceOf('paused');

    expect(await pause.setExperiencePaused(ops, target.id, 'unpause')).toEqual({
      status: 'unpaused',
    });

    expect(await statusOf(target.id)).toBe('live');
    expect(await auditRows(target.id)).toEqual([unpausedBy(false)]);
    expect(invalidated()).toContain(tags.experience(target.id));
  });

  it('keeps a paused experience out of what guests can see', () => {
    expect(guestVisibleStatuses).not.toContain('paused');
  });

  it.each([
    ['pause', 'draft', 'not_live'],
    ['pause', 'in_review', 'not_live'],
    ['pause', 'paused', 'not_live'],
    ['unpause', 'live', 'not_paused'],
    ['unpause', 'draft', 'not_paused'],
  ] as const)(
    'refuses to %s an experience that is %s with %s, and changes nothing',
    async (kind, status, refusal) => {
      const target = await experienceOf(status);

      expect(await pause.setExperiencePaused(ops, target.id, kind)).toEqual({
        status: refusal,
      });

      expect(await statusOf(target.id)).toBe(status);
      expect(await auditRows(target.id)).toEqual([]);
      expect(cache.updateTag).not.toHaveBeenCalled();
    },
  );

  it.each([[randomUUID()], ['not-an-id']])(
    'finds no experience for %s',
    async (id) => {
      expect(await pause.setExperiencePaused(ops, id, 'pause')).toEqual({
        status: 'not_found',
      });
    },
  );

  it('lets one of two pauses at once win, and writes one audit row', async () => {
    const target = await experienceOf('live');

    const results = await Promise.all([
      pause.setExperiencePaused(ops, target.id, 'pause'),
      pause.setExperiencePaused(ops, target.id, 'pause'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['not_live', 'paused']);
    expect(await auditRows(target.id)).toHaveLength(1);
  });
});

describe('suspending a host', () => {
  it('pauses every live experience the host has and nothing else, one audit row each and one for the host', async () => {
    const first = await experienceOf('live');
    const second = await experienceOf('live', first.hostId);
    const draft = await experienceOf('draft', first.hostId);
    const handPaused = await experienceOf('paused', first.hostId);
    const other = await experienceOf('live');

    expect(await pause.setHostSuspended(ops, first.hostId, 'pause')).toEqual({
      status: 'suspended',
      changedCount: 2,
    });

    expect(await statusOf(first.id)).toBe('paused');
    expect(await statusOf(second.id)).toBe('paused');
    expect(await statusOf(draft.id)).toBe('draft');
    expect(await statusOf(handPaused.id)).toBe('paused');
    expect(await statusOf(other.id)).toBe('live');
    expect(await auditRows(first.id)).toEqual([pausedBy(true)]);
    expect(await auditRows(second.id)).toEqual([pausedBy(true)]);
    expect(await auditRows(draft.id)).toEqual([]);
    expect(await auditRows(handPaused.id)).toEqual([]);
    expect(await auditRows(first.hostId)).toEqual([
      {
        action: 'host.suspended',
        actor_id: opsUser,
        details: { experiences_changed: 2 },
      },
    ]);
    expect(invalidated()).toEqual(
      expect.arrayContaining([
        tags.experience(first.id),
        tags.experience(second.id),
        tags.category(first.categorySlug),
        tags.category(second.categorySlug),
      ]),
    );
    expect(invalidated()).not.toContain(tags.experience(other.id));
  });

  it('changes nothing for a host with no live experience, or for no host', async () => {
    const target = await experienceOf('draft');

    expect(await pause.setHostSuspended(ops, target.hostId, 'pause')).toEqual({
      status: 'nothing_to_suspend',
    });
    for (const id of [randomUUID(), 'not-an-id']) {
      expect(await pause.setHostSuspended(ops, id, 'pause')).toEqual({
        status: 'not_found',
      });
    }

    expect(await auditRows(target.hostId)).toEqual([]);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });
});

describe('unsuspending a host', () => {
  it('unpauses the experiences a suspension paused and leaves one paused by hand', async () => {
    const suspended = await experienceOf('live');
    const byHand = await experienceOf('live', suspended.hostId);
    await pause.setExperiencePaused(ops, byHand.id, 'pause');
    await pause.setHostSuspended(ops, suspended.hostId, 'pause');
    cache.updateTag.mockClear();

    expect(
      await pause.setHostSuspended(ops, suspended.hostId, 'unpause'),
    ).toEqual({ status: 'unsuspended', changedCount: 1 });

    expect(await statusOf(suspended.id)).toBe('live');
    expect(await statusOf(byHand.id)).toBe('paused');
    expect(await auditRows(suspended.id)).toEqual([
      pausedBy(true),
      unpausedBy(true),
    ]);
    expect(await auditRows(byHand.id)).toEqual([pausedBy(false)]);
    expect(
      (await auditRows(suspended.hostId)).map((row) => row.action),
    ).toEqual(['host.suspended', 'host.unsuspended']);
    expect(invalidated()).toContain(tags.experience(suspended.id));
    expect(invalidated()).not.toContain(tags.experience(byHand.id));
  });

  it('leaves an experience paused by hand after a suspension and an unpause, and one paused with no audit row', async () => {
    const target = await experienceOf('live');
    const seeded = await experienceOf('paused', target.hostId);
    await pause.setHostSuspended(ops, target.hostId, 'pause');
    await pause.setExperiencePaused(ops, target.id, 'unpause');
    await pause.setExperiencePaused(ops, target.id, 'pause');

    expect(await pause.setHostSuspended(ops, target.hostId, 'unpause')).toEqual(
      { status: 'nothing_to_unsuspend' },
    );

    expect(await statusOf(target.id)).toBe('paused');
    expect(await statusOf(seeded.id)).toBe('paused');
  });

  it('does not touch an experience ops unpaused after the suspension', async () => {
    const target = await experienceOf('live');
    await pause.setHostSuspended(ops, target.hostId, 'pause');
    await pause.setExperiencePaused(ops, target.id, 'unpause');

    expect(await pause.setHostSuspended(ops, target.hostId, 'unpause')).toEqual(
      { status: 'nothing_to_unsuspend' },
    );

    expect(await auditRows(target.id)).toEqual([
      pausedBy(true),
      unpausedBy(false),
    ]);
  });
});

describe('the counts the host page shows', () => {
  it('follow the live experiences and the ones a suspension paused', async () => {
    const live = await experienceOf('live');
    await experienceOf('live', live.hostId);
    const byHand = await experienceOf('live', live.hostId);
    await pause.setExperiencePaused(ops, byHand.id, 'pause');

    expect(await pause.readHostSuspension(ops, live.hostId)).toEqual({
      liveCount: 2,
      suspendedCount: 0,
    });

    await pause.setHostSuspended(ops, live.hostId, 'pause');

    expect(await pause.readHostSuspension(ops, live.hostId)).toEqual({
      liveCount: 0,
      suspendedCount: 2,
    });
  });
});
