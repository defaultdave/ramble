import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { photoLimits } from '@/lib/photos';
import { anonymousCaller, ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  cancellationTiers,
  categories,
  experiences,
  hosts,
  neighborhoods,
  photos,
} from '@/server/db/schema';
import type { StoragePort } from '@/server/ports/storage';
import {
  createFakeStorageAdapter,
  type FakeStorageAdapter,
} from '@/server/ports/storage/fake';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - an added photo is stored, re-encoded, under a key made of its ids, and recorded with its size,
//   blur placeholder, alt text, and rights, at the next free position
// - a decorative photo is recorded with no alt text
// - ops adds to any experience, the host owner to their own host's, and nobody else to anyone's;
//   a refused caller stores nothing
// - bad input (blank alt text, no rights, a malformed experience id), a file that is not a photo,
//   and a missing experience each store nothing and write no row
// - a full gallery is refused before decoding, and two uploads racing for the last place give one
//   photo and one refusal, with the loser's file removed
// - a row that cannot be written removes its file again
// - guests list the photos of live and guide-only experiences in order, and none of a hidden one
// - each CHECK refuses its row; deleting an experience with photos is refused

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let photoStore: typeof import('@/server/db/photos');
let storage: FakeStorageAdapter;

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

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

async function insertExperience(
  hostId?: string,
  status: 'live' | 'draft' | 'guide_only' = 'live',
) {
  const [tier] = await client.db.select().from(cancellationTiers).limit(1);
  const [host] = hostId
    ? [{ id: hostId }]
    : await client.db
        .insert(hosts)
        .values({
          slug: unique('host'),
          name: unique('Host'),
          timeZone: 'America/New_York',
        })
        .returning();
  const [category] = await client.db
    .insert(categories)
    .values({ slug: unique('category'), name: unique('Category') })
    .returning();
  const [neighborhood] = await client.db
    .insert(neighborhoods)
    .values({ slug: unique('neighborhood'), name: unique('Neighborhood') })
    .returning();
  if (!tier || !category || !neighborhood) {
    throw new Error('fixture insert returned no row');
  }
  const [row] = await client.db
    .insert(experiences)
    .values({
      hostId: host.id,
      categoryId: category.id,
      neighborhoodId: neighborhood.id,
      cancellationTierId: tier.id,
      slug: unique('experience'),
      name: unique('Experience'),
      status,
      ...(status === 'guide_only'
        ? { linkOutUrl: 'https://example.com/' }
        : {}),
    })
    .returning();
  if (!row) throw new Error('fixture insert returned no experience');
  return row;
}

let validUpload: Buffer;
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

const ops = testCaller({ roles: [Role.Ops] });
const alt = { decorative: false, altText: 'A potter shaping a bowl' };
const rights = { basis: 'ramble_owned' };

function newPhoto(experienceId: string, overrides: object = {}) {
  return { experienceId, description: alt, rights, ...overrides };
}

async function photoRows(experienceId: string) {
  return client.db
    .select()
    .from(photos)
    .where(eq(photos.experienceId, experienceId))
    .orderBy(photos.position);
}

describe('addPhoto', () => {
  it('stores a re-encoded copy under a key made of its ids and records the row', async () => {
    const experience = await insertExperience();

    const added = await photoStore.addPhoto(
      ops,
      newPhoto(experience.id, {
        rights: {
          basis: 'licensed',
          holder: 'Ana Photographer',
          license: 'Unsplash License',
          sourceUrl: 'https://unsplash.com/photos/abc',
        },
      }),
      validUpload,
      storage,
    );

    const [row] = await photoRows(experience.id);
    expect(row).toMatchObject({
      id: added.id,
      position: 0,
      storageKey: `public/photos/${experience.id}/${added.id}.jpg`,
      width: 1600,
      height: 1000,
      decorative: false,
      altText: alt.altText,
      rightsBasis: 'licensed',
      rightsHolder: 'Ana Photographer',
      rightsLicense: 'Unsplash License',
      rightsSourceUrl: 'https://unsplash.com/photos/abc',
    });
    expect(row?.blurDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(row?.url).toContain(row?.storageKey);
    const stored = storage.read(row?.storageKey ?? '');
    expect(stored).not.toBeNull();
    expect(row?.byteSize).toBe(stored?.byteLength);
    expect((await sharp(stored ?? Buffer.alloc(0)).metadata()).format).toBe(
      'jpeg',
    );
    expect(added).toMatchObject({ id: row?.id, position: 0, url: row?.url });
    expect(added).not.toHaveProperty('storageKey');
    expect(added).not.toHaveProperty('rightsBasis');
  });

  it('takes the next position each time, and a freed one first', async () => {
    const experience = await insertExperience();
    const add = () =>
      photoStore.addPhoto(ops, newPhoto(experience.id), validUpload, storage);
    const first = await add();
    const second = await add();
    await add();

    await client.db.delete(photos).where(eq(photos.id, second.id));
    const refilled = await add();

    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(refilled.position).toBe(1);
  });

  it('records a decorative photo with no alt text', async () => {
    const experience = await insertExperience();

    await photoStore.addPhoto(
      ops,
      newPhoto(experience.id, { description: { decorative: true } }),
      validUpload,
      storage,
    );

    expect(await photoRows(experience.id)).toMatchObject([
      { decorative: true, altText: null },
    ]);
  });

  describe('who may add', () => {
    it('lets ops and admin add to any experience', async () => {
      const experience = await insertExperience();

      await photoStore.addPhoto(
        testCaller({ roles: [Role.Admin] }),
        newPhoto(experience.id),
        validUpload,
        storage,
      );

      expect(await photoRows(experience.id)).toHaveLength(1);
    });

    it("lets the owner of the experience's host add", async () => {
      const experience = await insertExperience();

      await photoStore.addPhoto(
        testCaller({
          roles: [Role.HostOwner],
          hostIds: [experience.hostId],
        }),
        newPhoto(experience.id),
        validUpload,
        storage,
      );

      expect(await photoRows(experience.id)).toHaveLength(1);
    });

    it.each([
      [
        'the owner of another host',
        () => testCaller({ roles: [Role.HostOwner], hostIds: [randomUUID()] }),
      ],
      ['a signed-out visitor', () => anonymousCaller],
      ['a guest', () => testCaller()],
      ['host staff', () => testCaller({ roles: [Role.HostStaff] })],
    ])('refuses %s and stores nothing', async (_name, makeCaller) => {
      const experience = await insertExperience();
      const spy = vi.spyOn(storage, 'put');

      await expect(
        photoStore.addPhoto(
          makeCaller(),
          newPhoto(experience.id),
          validUpload,
          storage,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(spy).not.toHaveBeenCalled();
      expect(await photoRows(experience.id)).toEqual([]);
      spy.mockRestore();
    });
  });

  describe('refusals store nothing', () => {
    async function expectNothingStored(
      experienceId: string,
      attempt: Promise<unknown>,
      error: new (...args: never[]) => Error | typeof Error,
    ) {
      const spy = vi.spyOn(storage, 'put');
      await expect(attempt).rejects.toBeInstanceOf(error);
      expect(spy).not.toHaveBeenCalled();
      expect(await photoRows(experienceId)).toEqual([]);
      spy.mockRestore();
    }

    it.each([
      ['blank alt text', { description: { decorative: false, altText: '  ' } }],
      ['no description', { description: undefined }],
      ['no rights record', { rights: undefined }],
      ['a malformed experience id', { experienceId: 'nope' }],
    ])('input with %s', async (_name, override) => {
      const experience = await insertExperience();

      await expectNothingStored(
        experience.id,
        photoStore.addPhoto(
          ops,
          { ...newPhoto(experience.id), ...override },
          validUpload,
          storage,
        ),
        Error,
      );
    });

    it('a file that is not a photo', async () => {
      const experience = await insertExperience();
      const { PhotoRefusedError } = await import('@/server/photos/ingest');

      await expectNothingStored(
        experience.id,
        photoStore.addPhoto(
          ops,
          newPhoto(experience.id),
          Buffer.from('not an image'),
          storage,
        ),
        PhotoRefusedError,
      );
    });

    it('an experience that does not exist', async () => {
      await expect(
        photoStore.addPhoto(ops, newPhoto(randomUUID()), validUpload, storage),
      ).rejects.toBeInstanceOf(photoStore.ExperienceNotFoundError);
    });
  });

  describe('the gallery limit', () => {
    async function fillGallery(experienceId: string, count: number) {
      for (let position = 0; position < count; position++) {
        const id = randomUUID();
        await client.db.insert(photos).values({
          id,
          experienceId,
          position,
          storageKey: `public/photos/${experienceId}/${id}.jpg`,
          url: `https://abc123.public.blob.vercel-storage.com/public/photos/${experienceId}/${id}.jpg`,
          width: 1600,
          height: 1000,
          byteSize: 1000,
          decorative: true,
          blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
          rightsBasis: 'ramble_owned',
        });
      }
    }

    it('is refused before the upload is decoded or stored', async () => {
      const experience = await insertExperience();
      await fillGallery(experience.id, photoLimits.maxPerExperience);
      const spy = vi.spyOn(storage, 'put');

      await expect(
        // Not an image: reaching the decoder would give a different error.
        photoStore.addPhoto(
          ops,
          newPhoto(experience.id),
          Buffer.from('x'),
          storage,
        ),
      ).rejects.toBeInstanceOf(photoStore.PhotoLimitError);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('lets two uploads race for the last place: one wins, one is refused and its file is removed', async () => {
      const experience = await insertExperience();
      await fillGallery(experience.id, photoLimits.maxPerExperience - 1);
      const stored: string[] = [];
      // Both uploads wait here until both have stored their file, so both reach the transaction together.
      let arrived = 0;
      let release: () => void = () => undefined;
      const bothArrived = new Promise<void>((resolve) => {
        release = resolve;
      });
      const recording: StoragePort = {
        ...storage,
        put: async (input) => {
          stored.push(input.key);
          const result = await storage.put(input);
          arrived += 1;
          if (arrived === 2) release();
          await bothArrived;
          return result;
        },
      };

      const results = await Promise.allSettled([
        photoStore.addPhoto(
          ops,
          newPhoto(experience.id),
          validUpload,
          recording,
        ),
        photoStore.addPhoto(
          ops,
          newPhoto(experience.id),
          validUpload,
          recording,
        ),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
        photoStore.PhotoLimitError,
      );
      expect(await photoRows(experience.id)).toHaveLength(
        photoLimits.maxPerExperience,
      );
      const kept = (await photoRows(experience.id)).map(
        (row) => row.storageKey,
      );
      const leftover = stored.filter((key) => storage.read(key) !== null);
      expect(leftover).toHaveLength(1);
      expect(kept).toContain(leftover[0]);
    });
  });

  it('removes the stored file when the row cannot be written', async () => {
    const experience = await insertExperience();
    const stored: string[] = [];
    const deletesExperience: StoragePort = {
      ...storage,
      put: async (input) => {
        const result = await storage.put(input);
        stored.push(input.key);
        await client.db
          .delete(experiences)
          .where(eq(experiences.id, experience.id));
        return result;
      },
    };

    await expect(
      photoStore.addPhoto(
        ops,
        newPhoto(experience.id),
        validUpload,
        deletesExperience,
      ),
    ).rejects.toThrow();

    expect(stored).toHaveLength(1);
    expect(storage.read(stored[0] ?? '')).toBeNull();
  });
});

describe('listGuestPhotos', () => {
  async function add(experienceId: string, altText: string) {
    return photoStore.addPhoto(
      ops,
      newPhoto(experienceId, { description: { decorative: false, altText } }),
      validUpload,
      storage,
    );
  }

  it('lists a live experience in gallery order, with only what a page renders', async () => {
    const experience = await insertExperience();
    await add(experience.id, 'first');
    await add(experience.id, 'second');
    await add(experience.id, 'third');

    const listed = await photoStore.listGuestPhotos(experience.id);

    expect(listed.map((photo) => photo.altText)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(listed.map((photo) => photo.position)).toEqual([0, 1, 2]);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual(
      [
        'altText',
        'blurDataUrl',
        'decorative',
        'experienceId',
        'height',
        'id',
        'position',
        'url',
        'width',
      ].sort(),
    );
  });

  it('lists a guide-only experience', async () => {
    const experience = await insertExperience(undefined, 'guide_only');
    await add(experience.id, 'guide');

    expect(await photoStore.listGuestPhotos(experience.id)).toHaveLength(1);
  });

  it.each(['draft', 'in_review', 'paused'] as const)(
    'lists nothing for a %s experience',
    async (status) => {
      const experience = await insertExperience();
      await add(experience.id, 'hidden');
      await client.db
        .update(experiences)
        .set({ status })
        .where(eq(experiences.id, experience.id));

      expect(await photoStore.listGuestPhotos(experience.id)).toEqual([]);
    },
  );

  it.each(['not-a-uuid', '', randomUUID()])(
    'lists nothing for the id %j',
    async (id) => {
      expect(await photoStore.listGuestPhotos(id)).toEqual([]);
    },
  );
});

describe('photos constraints', () => {
  async function validRow(overrides: Record<string, unknown> = {}) {
    const experience = await insertExperience();
    const id = randomUUID();
    return {
      id,
      experience_id: experience.id,
      position: 0,
      storage_key: `public/photos/${experience.id}/${id}.jpg`,
      url: `https://abc123.public.blob.vercel-storage.com/public/photos/${experience.id}/${id}.jpg`,
      width: 1600,
      height: 1000,
      byte_size: 1000,
      decorative: false,
      alt_text: 'A potter shaping a bowl',
      blur_data_url: 'data:image/jpeg;base64,/9j/4AAQ',
      rights_basis: 'ramble_owned',
      rights_holder: null,
      rights_license: null,
      rights_source_url: null,
      ...overrides,
    };
  }

  function insert(row: Record<string, unknown>) {
    const columns = Object.keys(row);
    return client.db.execute(
      sql`INSERT INTO photos (${sql.raw(columns.join(', '))}) VALUES (${sql.join(
        columns.map((column) => sql`${row[column]}`),
        sql`, `,
      )})`,
    );
  }

  it('accepts a well-formed row', async () => {
    await expect(insert(await validRow())).resolves.toBeDefined();
  });

  const licensed = {
    rights_basis: 'licensed',
    rights_holder: 'Ana',
    rights_license: 'Unsplash License',
    rights_source_url: 'https://unsplash.com/photos/abc',
  };

  it('accepts a complete licensed row', async () => {
    await expect(insert(await validRow(licensed))).resolves.toBeDefined();
  });

  it.each([
    ['photos_position_in_range', { position: -1 }],
    ['photos_position_in_range', { position: photoLimits.maxPerExperience }],
    [
      'photos_storage_key_from_ids',
      { storage_key: 'public/photos/other/other.jpg' },
    ],
    ['photos_url_http', { url: 'javascript:alert(1)' }],
    [
      'photos_url_http',
      { url: `https://example.com/${'a'.repeat(photoLimits.maxUrlLength)}` },
    ],
    ['photos_dimensions_in_range', { width: 0 }],
    ['photos_dimensions_in_range', { height: photoLimits.storedEdge + 1 }],
    ['photos_byte_size_in_range', { byte_size: 0 }],
    [
      'photos_byte_size_in_range',
      { byte_size: photoLimits.maxStoredBytes + 1 },
    ],
    ['photos_alt_or_decorative', { alt_text: null }],
    ['photos_alt_or_decorative', { alt_text: '   ' }],
    ['photos_alt_or_decorative', { alt_text: '' }],
    [
      'photos_alt_or_decorative',
      { alt_text: 'a'.repeat(photoLimits.maxAltLength + 1) },
    ],
    ['photos_alt_or_decorative', { decorative: true }],
    ['photos_blur_data_url', { blur_data_url: 'https://example.com/a.jpg' }],
    [
      'photos_blur_data_url',
      { blur_data_url: 'data:text/html;base64,PHNjcmlwdD4=' },
    ],
    [
      'photos_blur_data_url',
      {
        blur_data_url: `data:image/jpeg;base64,${'A'.repeat(photoLimits.maxBlurLength)}`,
      },
    ],
    ['photos_rights_holder', { rights_holder: '  ' }],
    [
      'photos_rights_holder',
      { rights_holder: 'a'.repeat(photoLimits.maxRightsTextLength + 1) },
    ],
    [
      'photos_rights_license',
      {
        rights_basis: 'licensed',
        rights_holder: 'Ana',
        rights_license: ' ',
        rights_source_url: 'https://example.com/',
      },
    ],
    [
      'photos_rights_source_url',
      { ...licensed, rights_source_url: 'ftp://example.com/a' },
    ],
    ['photos_rights_licensed_complete', { ...licensed, rights_holder: null }],
    ['photos_rights_licensed_complete', { ...licensed, rights_license: null }],
    [
      'photos_rights_licensed_complete',
      { ...licensed, rights_source_url: null },
    ],
    ['photos_rights_unlicensed_bare', { rights_license: 'Unsplash License' }],
    [
      'photos_rights_unlicensed_bare',
      { rights_source_url: 'https://example.com/' },
    ],
    ['photos_created_at_in_range', { created_at: 'infinity' }],
  ])('%s refuses %j', async (constraint, override) => {
    const row = await validRow(override);

    await expect(insert(row)).rejects.toMatchObject({ cause: { constraint } });
  });

  it('refuses a second photo at the same position of an experience', async () => {
    const first = await validRow();
    await insert(first);
    const id = randomUUID();

    await expect(
      insert({
        ...first,
        id,
        storage_key: `public/photos/${first.experience_id}/${id}.jpg`,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'photos_experience_position_unique' },
    });
  });

  it('refuses a photo for an experience that does not exist', async () => {
    const id = randomUUID();
    const experienceId = randomUUID();

    await expect(
      insert({
        ...(await validRow()),
        id,
        experience_id: experienceId,
        storage_key: `public/photos/${experienceId}/${id}.jpg`,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'photos_experience_id_experiences_id_fk' },
    });
  });

  it('refuses to delete an experience that has photos', async () => {
    const row = await validRow();
    await insert(row);

    await expect(
      client.db
        .delete(experiences)
        .where(eq(experiences.id, row.experience_id)),
    ).rejects.toMatchObject({
      cause: { constraint: 'photos_experience_id_experiences_id_fk' },
    });
  });
});
