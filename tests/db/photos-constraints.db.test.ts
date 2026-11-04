import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { photoLimits } from '@/lib/photos';
import { experiences } from '@/server/db/schema';
import {
  client,
  insertExperience,
  setupPhotosDatabase,
} from './photosFixtures';

// Behaviours under test:
// - each CHECK refuses its row; deleting an experience with photos is refused

setupPhotosDatabase();

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
