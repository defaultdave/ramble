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
import { tags } from '@/lib/cacheTags';
import { hasPhotoDescription } from '@/lib/photos';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { experiences, photos } from '@/server/db/schema';
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
// Approving:
// - an experience in review goes live with one audit row naming the ops user, and its listing tags are invalidated after the commit
// - photos that are described or decorative, or no photos at all, do not stop an approval
// Rejecting:
// - an experience in review goes back to draft with one audit row carrying the reason's code, and nothing is invalidated
// Refusals:
// - an experience in any other status is not in review: nothing changes, no audit row, nothing invalidated
// - an id that is no experience, or no id, is not_found
// - two approvals at once: one wins, the other finds it no longer in review, and one audit row is written
// - a photo with no alt text that is not decorative refuses an approval, naming it by its place in the gallery, and changes nothing; a rejection still goes through

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editor: typeof import('@/server/db/experienceEditor');
let review: typeof import('@/server/db/experienceReview');
let fixtures: ReturnType<typeof catalogFixtures>;

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });
const approve = { kind: 'approve' } as const;
const reject = { kind: 'reject', reason: 'photos' } as const;

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
  editor = await import('@/server/db/experienceEditor');
  review = await import('@/server/db/experienceReview');
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

async function inReview(status: 'in_review' | 'draft' | 'live' | 'paused') {
  const parents = await fixtures.parents();
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
    categorySlug: category?.slug ?? '',
    neighborhoodSlug: neighborhood?.slug ?? '',
  };
}

async function addPhoto(
  experienceId: string,
  position: number,
  alt: { decorative: true } | { altText: string | null },
) {
  const id = randomUUID();
  await client.db.insert(photos).values({
    id,
    experienceId,
    position,
    storageKey: `public/photos/${experienceId}/${id}.jpg`,
    url: `https://store.example/${experienceId}/${String(position)}.jpg`,
    width: 1600,
    height: 1000,
    byteSize: 1000,
    decorative: 'decorative' in alt,
    altText: 'altText' in alt ? alt.altText : null,
    blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    rightsBasis: 'ramble_owned',
  });
}

async function dropAltCheck() {
  await client.db.execute(
    sql`ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_alt_or_decorative`,
  );
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

describe('access', () => {
  it.each(refused)('refuses %s and changes nothing', async (_who, caller) => {
    const target = await inReview('in_review');

    await expect(
      review.decideExperienceReview(caller, target.id, approve),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await statusOf(target.id)).toBe('in_review');
    expect(await auditRows(target.id)).toEqual([]);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });
});

describe('approving', () => {
  it('makes an experience in review live with one audit row, and invalidates its listing tags', async () => {
    const target = await inReview('in_review');
    await addPhoto(target.id, 0, { altText: 'A bowl on the wheel' });
    await addPhoto(target.id, 1, { decorative: true });

    const result = await review.decideExperienceReview(ops, target.id, approve);

    expect(result).toEqual({ status: 'approved' });
    expect(await statusOf(target.id)).toBe('live');
    expect(await auditRows(target.id)).toEqual([
      {
        action: 'experience.approved',
        actor_id: opsUser,
        details: { from_status: 'in_review', to_status: 'live' },
      },
    ]);
    expect(invalidated()).toEqual(
      expect.arrayContaining([
        tags.experience(target.id),
        tags.catalog,
        tags.category(target.categorySlug),
        tags.neighborhood(target.neighborhoodSlug),
      ]),
    );
  });

  it('approves an experience with no photos', async () => {
    const target = await inReview('in_review');

    expect(
      await review.decideExperienceReview(ops, target.id, approve),
    ).toEqual({ status: 'approved' });
  });
});

describe('rejecting', () => {
  it('sends an experience in review back to draft with the reason as a code, and invalidates nothing', async () => {
    const target = await inReview('in_review');

    const result = await review.decideExperienceReview(ops, target.id, reject);

    expect(result).toEqual({ status: 'rejected' });
    expect(await statusOf(target.id)).toBe('draft');
    expect(await auditRows(target.id)).toEqual([
      {
        action: 'experience.rejected',
        actor_id: opsUser,
        details: {
          from_status: 'in_review',
          to_status: 'draft',
          reason: 'photos',
        },
      },
    ]);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });
});

describe('refusals', () => {
  it.each(['draft', 'live', 'paused'] as const)(
    'finds a %s experience not in review and changes nothing',
    async (status) => {
      const target = await inReview(status);

      for (const decision of [approve, reject]) {
        expect(
          await review.decideExperienceReview(ops, target.id, decision),
        ).toEqual({ status: 'not_in_review' });
      }

      expect(await statusOf(target.id)).toBe(status);
      expect(await auditRows(target.id)).toEqual([]);
      expect(cache.updateTag).not.toHaveBeenCalled();
    },
  );

  it.each([[randomUUID()], ['not-an-id']])(
    'finds no experience for %s',
    async (id) => {
      expect(await review.decideExperienceReview(ops, id, approve)).toEqual({
        status: 'not_found',
      });
    },
  );

  it('lets one of two approvals at once win, and writes one audit row', async () => {
    const target = await inReview('in_review');

    const results = await Promise.all([
      review.decideExperienceReview(ops, target.id, approve),
      review.decideExperienceReview(ops, target.id, approve),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'approved',
      'not_in_review',
    ]);
    expect(await auditRows(target.id)).toHaveLength(1);
  });

  // These last two drop the table's own alt-text CHECK from this file's database to put in a
  // photo the database would never let in: the check in the decision is the one under test.
  it('refuses an approval naming each photo with no alt text, changes nothing, and still allows a rejection', async () => {
    await dropAltCheck();
    const target = await inReview('in_review');
    await addPhoto(target.id, 0, { altText: 'A bowl on the wheel' });
    await addPhoto(target.id, 2, { altText: '   ' });
    await addPhoto(target.id, 5, { decorative: true });
    await addPhoto(target.id, 7, { altText: null });

    const result = await review.decideExperienceReview(ops, target.id, approve);

    expect(result).toEqual({ status: 'alt_missing', photoNumbers: [2, 4] });
    expect(await statusOf(target.id)).toBe('in_review');
    expect(await auditRows(target.id)).toEqual([]);
    expect(cache.updateTag).not.toHaveBeenCalled();
    expect(await review.decideExperienceReview(ops, target.id, reject)).toEqual(
      {
        status: 'rejected',
      },
    );
  });

  it('numbers the photos a refusal names as the gallery the page shows them, whatever order they were added in', async () => {
    await dropAltCheck();
    const target = await inReview('in_review');
    await addPhoto(target.id, 9, { altText: null });
    await addPhoto(target.id, 3, { altText: 'Described' });
    await addPhoto(target.id, 0, { altText: null });
    await addPhoto(target.id, 6, { decorative: true });

    const result = await review.decideExperienceReview(ops, target.id, approve);

    const view = await editor.readExperienceForOps(ops, target.id);
    const shown = (view?.photos ?? [])
      .map((photo, index) => (hasPhotoDescription(photo) ? null : index + 1))
      .filter((number) => number !== null);
    expect(shown).toEqual([1, 4]);
    expect(result).toEqual({ status: 'alt_missing', photoNumbers: shown });
  });
});
