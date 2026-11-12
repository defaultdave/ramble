import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, vi } from 'vitest';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { photos } from '@/server/db/schema';
import {
  createFakeStorageAdapter,
  type FakeStorageAdapter,
} from '@/server/ports/storage/fake';
import { catalogFixtures } from './catalogFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

/** A photo added to a visible experience publishes its tag, which only a Server Action may do. */
const hoisted = vi.hoisted(() => ({ updateTag: vi.fn() }));
export const updateTag = hoisted.updateTag;
vi.mock('next/cache', () => ({
  updateTag: hoisted.updateTag,
  revalidateTag: vi.fn(),
}));

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
export let client: typeof import('@/server/db/client');
export let photoStore: typeof import('@/server/db/photos');
export let storage: FakeStorageAdapter;
export let validUpload: Buffer;

/** Opens a fresh database for the file that calls it and loads the modules that read DATABASE_URL. */
export function setupPhotosDatabase() {
  beforeAll(async () => {
    fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
    stopHttp = await serveNeonHttp(fresh.url);
    vi.stubEnv('DATABASE_URL', fresh.url);
    client = await import('@/server/db/client');
    photoStore = await import('@/server/db/photos');
    storage = createFakeStorageAdapter({ now: () => new Date() });
  });

  afterAll(async () => {
    await client.db.$client.end();
    await stopHttp();
    await fresh.dispose();
    vi.unstubAllEnvs();
  });

  beforeAll(async () => {
    validUpload = await sharp({
      create: {
        width: 1600,
        height: 1000,
        channels: 3,
        background: { r: 20, g: 120, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();
  });
}

const fixtures = catalogFixtures(() => client.db);

export async function insertExperience(
  hostId?: string,
  status: 'live' | 'draft' | 'guide_only' = 'live',
) {
  return fixtures.insertExperience(await fixtures.parents(hostId), {
    status,
    ...(status === 'guide_only' ? { linkOutUrl: 'https://example.com/' } : {}),
  });
}

/** An audit row names a real user id, so every caller that adds a photo has one. */
export const opsUserId = randomUUID();
export const ops = testCaller({ userId: opsUserId, roles: [Role.Ops] });
export const alt = { decorative: false, altText: 'A potter shaping a bowl' };
const rights = { basis: 'ramble_owned' };

export function newPhoto(experienceId: string, overrides: object = {}) {
  return { experienceId, description: alt, rights, ...overrides };
}

export async function photoRows(experienceId: string) {
  return client.db
    .select()
    .from(photos)
    .where(eq(photos.experienceId, experienceId))
    .orderBy(photos.position);
}
