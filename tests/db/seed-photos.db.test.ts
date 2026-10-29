import { count, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { photoStorageKey } from '@/lib/photos';
import { curated } from '@/lib/seed/fixtures';
import { experienceId } from '@/lib/seed/rows';
import { planTestPhotos } from '@/lib/seed/testPhotos';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { photos } from '@/server/db/schema';
import {
  createFakeStorageAdapter,
  type FakeStorageAdapter,
} from '@/server/ports/storage/fake';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - the photo step gives every curated experience its planned photos, with a cover at position 0, through
//   the ingest and storage port: stored copies are JPEGs of the planned size class, the rows carry the
//   stored size, alt text, the generated-image rights, and an address under the public photo path
// - the coverage read finds no gap after a run, and names an experience whose photos are removed
// - a rerun writes nothing and keeps every id, url, and created-at
// - a row removed but its file left (a stopped run) is rewritten under the same id and key
// - a photo already at a position, from any source, is left alone and its position is not planned again
// - a photo whose row loses a race for its position is not counted, and its file is removed again
// - a photo whose id (and so its storage key, which the CHECK builds from the ids) is taken by a row at
//   another position is not counted, and its file is kept because that row points at it
// - a file is cleared before a put only when no row owns its key
// - the step refuses a caller who is not ops before any write

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let stepModule: typeof import('@/server/db/seed/photos');
let seedCaller: typeof import('@/server/db/seed/caller').seedCaller;
let storage: FakeStorageAdapter;

const stepTimeout = 120_000;
const now = new Date('2026-10-28T15:00:00Z');
const plannedTotal = curated.experiences.reduce(
  (sum, fixture) => sum + planTestPhotos(fixture).length,
  0,
);

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  stepModule = await import('@/server/db/seed/photos');
  ({ seedCaller } = await import('@/server/db/seed/caller'));
  const runner = await import('@/server/db/seed/run');
  await runner.runSeed({ caller: seedCaller, now });
  storage = createFakeStorageAdapter({ now: () => now });
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const rows = () => client.db.select().from(photos);

describe('the photo step', () => {
  it('refuses a caller who is not ops before writing anything', async () => {
    await expect(
      stepModule.seedTestPhotos(
        { userId: 'g', roles: [Role.Guest], hostIds: [] },
        storage,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await rows()).toHaveLength(0);
  });

  it(
    'fills every curated experience through ingest and storage',
    async () => {
      const report = await stepModule.seedTestPhotos(seedCaller, storage);
      expect(report).toEqual({ created: plannedTotal, alreadyThere: 0 });
      const stored = await rows();
      expect(stored).toHaveLength(plannedTotal);
      for (const fixture of curated.experiences) {
        const own = stored
          .filter((row) => row.experienceId === experienceId(fixture.slug))
          .sort((a, b) => a.position - b.position);
        expect(own.map((row) => row.position)).toEqual(
          planTestPhotos(fixture).map((photo) => photo.position),
        );
        expect(own.length).toBeGreaterThanOrEqual(3);
      }
    },
    stepTimeout,
  );

  it('stores a JPEG of the planned size class with alt text and rights on each row', async () => {
    const [row] = await client.db
      .select()
      .from(photos)
      .where(
        eq(photos.experienceId, experienceId('sunset-kayak-on-the-hudson')),
      )
      .orderBy(photos.position)
      .limit(1);
    expect(row?.position).toBe(0);
    expect(row?.storageKey).toBe(
      photoStorageKey(row?.experienceId ?? '', row?.id ?? ''),
    );
    expect(row?.url).toContain('/public/photos/');
    expect(row?.altText?.length).toBeGreaterThan(0);
    expect(row?.rightsBasis).toBe('ramble_owned');
    const bytes = storage.read(row?.storageKey ?? '');
    const meta = await sharp(Buffer.from(bytes ?? [])).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([row?.width, row?.height]);
    expect(row?.byteSize).toBe(bytes?.byteLength);
  });

  it('mixes the small, medium, and ceiling sizes inside every experience', async () => {
    const stored = await rows();
    for (const fixture of curated.experiences) {
      const edges = stored
        .filter((row) => row.experienceId === experienceId(fixture.slug))
        .filter((row) => row.position < 3)
        .map((row) => Math.max(row.width, row.height))
        .sort((a, b) => a - b);
      expect(edges).toEqual([1600, 1920, 2400]);
    }
  });

  it('finds no coverage gap after a run', async () => {
    expect(await stepModule.readPhotoCoverageGaps(seedCaller)).toEqual([]);
  });

  it(
    'writes nothing on a rerun and keeps every row as it was',
    async () => {
      const before = await rows();
      const report = await stepModule.seedTestPhotos(seedCaller, storage);
      expect(report).toEqual({ created: 0, alreadyThere: plannedTotal });
      const after = await rows();
      const byId = (list: typeof before) =>
        [...list].sort((a, b) => a.id.localeCompare(b.id));
      expect(byId(after)).toEqual(byId(before));
    },
    stepTimeout,
  );

  it(
    'rewrites a photo whose row is gone but whose file was left behind',
    async () => {
      const [victim] = await client.db
        .select()
        .from(photos)
        .where(eq(photos.position, 1))
        .limit(1);
      await client.db.delete(photos).where(eq(photos.id, victim?.id ?? ''));
      expect(storage.read(victim?.storageKey ?? '')).not.toBeNull();
      const report = await stepModule.seedTestPhotos(seedCaller, storage);
      expect(report).toEqual({ created: 1, alreadyThere: plannedTotal - 1 });
      const [restored] = await client.db
        .select()
        .from(photos)
        .where(eq(photos.id, victim?.id ?? ''));
      expect(restored?.storageKey).toBe(victim?.storageKey);
    },
    stepTimeout,
  );

  it('names an experience whose photos are removed', async () => {
    const slug = 'kids-wheel-class';
    await client.db
      .delete(photos)
      .where(eq(photos.experienceId, experienceId(slug)));
    const gaps = await stepModule.readPhotoCoverageGaps(seedCaller);
    expect(gaps).toEqual([
      `${slug} has no cover`,
      `${slug} has 0 photos, needs 3`,
    ]);
  });

  it(
    'leaves a photo from another source in place and plans around its position',
    async () => {
      const slug = 'kids-wheel-class';
      const id = experienceId(slug);
      const foreignId = '00000000-0000-4000-8000-000000000001';
      await client.db.insert(photos).values({
        id: foreignId,
        experienceId: id,
        position: 0,
        storageKey: photoStorageKey(id, foreignId),
        url: 'https://example.invalid/foreign.jpg',
        width: 1600,
        height: 1067,
        byteSize: 1000,
        altText: 'A photo someone else put here',
        blurDataUrl: 'data:image/jpeg;base64,AAAA',
        rightsBasis: 'host_agreement',
      });
      const report = await stepModule.seedTestPhotos(seedCaller, storage);
      const planned = planTestPhotos({ slug, name: slug }).length;
      expect(report.created).toBe(planned - 1);
      const [cover] = await client.db
        .select()
        .from(photos)
        .where(eq(photos.id, foreignId));
      expect(cover?.url).toBe('https://example.invalid/foreign.jpg');
      const [{ n } = { n: 0 }] = await client.db
        .select({ n: count() })
        .from(photos)
        .where(eq(photos.experienceId, id));
      expect(n).toBe(planned);
    },
    stepTimeout,
  );
  describe('when a row appears while the files are being stored', () => {
    const slug = 'sunday-sound-bath';
    const id = experienceId(slug);
    const plan = planTestPhotos({ slug, name: slug });

    const rival = (rivalId: string, position: number) => ({
      id: rivalId,
      experienceId: id,
      position,
      storageKey: photoStorageKey(id, rivalId),
      url: 'https://example.invalid/rival.jpg',
      width: 1600,
      height: 1067,
      byteSize: 1000,
      altText: 'A rival photo',
      blurDataUrl: 'data:image/jpeg;base64,AAAA',
      rightsBasis: 'host_agreement' as const,
    });

    /** The fake store, with a row inserted right after the file of `key` is stored. */
    const racing = (key: string, row: ReturnType<typeof rival>) => ({
      ...storage,
      provider: storage.provider,
      delete: storage.delete.bind(storage),
      getSignedUrl: storage.getSignedUrl.bind(storage),
      put: async (input: Parameters<typeof storage.put>[0]) => {
        const stored = await storage.put(input);
        if (input.key === key) await client.db.insert(photos).values(row);
        return stored;
      },
    });

    it(
      'counts only the rows written and removes the file of one that lost its position',
      async () => {
        await client.db.delete(photos).where(eq(photos.experienceId, id));
        const lost = plan[1];
        const report = await stepModule.seedTestPhotos(
          seedCaller,
          racing(
            lost?.storageKey ?? '',
            rival('00000000-0000-4000-8000-000000000002', 1),
          ),
        );
        expect(report).toEqual({
          created: plan.length - 1,
          alreadyThere: plannedTotal - (plan.length - 1),
        });
        expect(storage.read(lost?.storageKey ?? '')).toBeNull();
        const stored = await client.db
          .select({ id: photos.id })
          .from(photos)
          .where(eq(photos.experienceId, id));
        expect(stored).toHaveLength(plan.length);
        expect(stored.map((row) => row.id)).toContain(
          '00000000-0000-4000-8000-000000000002',
        );
      },
      stepTimeout,
    );

    it(
      'counts only the rows written and keeps the file a row with the same id points at',
      async () => {
        await client.db.delete(photos).where(eq(photos.experienceId, id));
        const taken = plan[2];
        const report = await stepModule.seedTestPhotos(
          seedCaller,
          racing(taken?.storageKey ?? '', rival(taken?.photoId ?? '', 15)),
        );
        expect(report).toEqual({
          created: plan.length - 1,
          alreadyThere: plannedTotal - (plan.length - 1),
        });
        expect(storage.read(taken?.storageKey ?? '')).not.toBeNull();
        const [owner] = await client.db
          .select({ position: photos.position })
          .from(photos)
          .where(eq(photos.id, taken?.photoId ?? ''));
        expect(owner?.position).toBe(15);
      },
      stepTimeout,
    );

    it(
      'does not clear a file that a row at another position owns',
      async () => {
        await client.db.delete(photos).where(eq(photos.experienceId, id));
        const owned = plan[0];
        await client.db.insert(photos).values(rival(owned?.photoId ?? '', 15));
        const deleted: string[] = [];
        const watching = {
          ...storage,
          provider: storage.provider,
          put: storage.put.bind(storage),
          getSignedUrl: storage.getSignedUrl.bind(storage),
          delete: async (input: { key: string }) => {
            deleted.push(input.key);
            await storage.delete(input);
          },
        };
        await stepModule.seedTestPhotos(seedCaller, watching);
        expect(deleted).not.toContain(owned?.storageKey);
      },
      stepTimeout,
    );
  });
});
