import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { notBlankPattern } from '@/lib/text';
import { createFreshDatabase, type FreshDatabase } from './harness';

// Behaviours under test, one per decision, branch or risk.
// - the database CHECK class (notBlankPattern) calls blank exactly the code points JavaScript's \s does,
//   over every code point of the basic multilingual plane except the surrogates Postgres cannot hold
// - an existing editorial column (collections.title) refuses U+00A0 and U+FEFF alone, and keeps real text

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

describe('blank text in the database', () => {
  it('agrees with JavaScript on every code point it can hold', async () => {
    const { rows } = await client.db.execute<{ code: number }>(
      sql`SELECT g AS code FROM generate_series(1, 65535) AS g
        WHERE (g NOT BETWEEN 55296 AND 57343) AND NOT (chr(g) ~ ${notBlankPattern})
        ORDER BY g`,
    );
    const databaseBlank = rows.map((row) => row.code);
    const javascriptBlank: number[] = [];
    for (let unit = 1; unit <= 0xffff; unit += 1) {
      if (unit >= 0xd800 && unit <= 0xdfff) continue;
      if (!/\S/.test(String.fromCharCode(unit))) javascriptBlank.push(unit);
    }

    expect(databaseBlank).toEqual(javascriptBlank);
  });

  const insertTitle = (slug: string, title: string) =>
    client.db.execute(
      sql`INSERT INTO collections (kind, slug, title) VALUES ('pick', ${slug}, ${title})`,
    );

  it.each([
    ['U+00A0', ' ', 'blank-nbsp'],
    ['U+FEFF', '﻿', 'blank-bom'],
  ])('refuses a collection title of only %s', async (_name, value, slug) => {
    await expect(insertTitle(slug, value)).rejects.toMatchObject({
      cause: { constraint: 'collections_title' },
    });
  });

  it('keeps a title with real text between them', async () => {
    await insertTitle('real-text', ' Picks﻿');
  });
});
