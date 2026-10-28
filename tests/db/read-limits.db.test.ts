import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogLimits } from '@/lib/catalog';
import { editorialLimits } from '@/lib/editorial';
import { categories, homeModules, neighborhoods } from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - the home page reads at most the limit of enabled modules, even when the table holds one more
// - the category and neighborhood lists read at most their limits, even when the table holds one more
// Each read is checked on a table that holds a row past the limit, so a removed `.limit()` fails the test.

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');
let catalog: typeof import('@/server/db/catalog');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
  catalog = await import('@/server/db/catalog');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

describe('list reads stop at their limit', () => {
  it('lists at most the limit of home modules', async () => {
    // The position CHECK already keeps the table at the limit; this database drops it to prove the read does not depend on it.
    await client.db.execute(
      sql`ALTER TABLE home_modules DROP CONSTRAINT home_modules_position_in_range`,
    );
    await client.db.insert(homeModules).values(
      Array.from(
        { length: editorialLimits.homeModules + 1 },
        (_, position) => ({
          position,
          kind: 'reassurance' as const,
        }),
      ),
    );

    const listed = await editorial.listHomeModules();

    expect(listed).toHaveLength(editorialLimits.homeModules);
    expect(listed.map((entry) => entry.position)).not.toContain(
      editorialLimits.homeModules,
    );
  });

  it('lists at most the limit of categories', async () => {
    await client.db.insert(categories).values(
      Array.from({ length: catalogLimits.categories + 1 }, (_, n) => ({
        slug: `category-${String(n)}`,
        name: `Category ${String(n).padStart(3, '0')}`,
      })),
    );

    const listed = await catalog.listCategories();

    expect(listed).toHaveLength(catalogLimits.categories);
  });

  it('lists at most the limit of neighborhoods', async () => {
    await client.db.insert(neighborhoods).values(
      Array.from({ length: catalogLimits.neighborhoods + 1 }, (_, n) => ({
        slug: `neighborhood-${String(n)}`,
        name: `Neighborhood ${String(n).padStart(3, '0')}`,
      })),
    );

    const listed = await catalog.listNeighborhoods();

    expect(listed).toHaveLength(catalogLimits.neighborhoods);
  });
});
