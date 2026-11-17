import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newExperienceValues } from '@/lib/experienceEditor';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { auditLog } from '@/server/db/schema';
import { catalogFixtures, unique, type Parents } from './catalogFixtures';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction as race,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, against the real database, one per decision, branch or risk:
// - the links are merged into the experience as locked: a change to another field committed while the save waited is kept, and the audit row names the links only
// - a save with the same links writes nothing; an experience that is not guide-only is not_a_guide and an unknown id is not_found, and neither writes
// - a caller who is not ops is refused, and nothing is written

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editor: typeof import('@/server/db/experienceEditor');
let fixtures: ReturnType<typeof catalogFixtures>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editor = await import('@/server/db/experienceEditor');
  fixtures = catalogFixtures(() => client.db);
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });
const links = {
  linkOutUrl: 'https://host.example.com/classes',
  affiliateUrl: 'https://host.example.com/classes?ref=ramble',
};

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

async function parents(): Promise<Parents> {
  return {
    hostId: (await fixtures.insertHost()).id,
    categoryId: (await fixtures.insertCategory()).id,
    neighborhoodId: (await fixtures.insertNeighborhood()).id,
    cancellationTierId: await fixtures.defaultTierId(),
  };
}

async function guideEntry(): Promise<string> {
  const p = await parents();
  const n = unique('guide');
  const created = await editor.createExperience(ops, {
    ...newExperienceValues(p),
    name: `Guide ${n}`,
    slug: n,
    hostId: p.hostId,
  });
  if (created.status !== 'created') throw new Error('expected an experience');
  await client.db.execute(
    sql`UPDATE experiences SET status = 'guide_only', link_out_url = 'https://old.example.com/a' WHERE id = ${created.experienceId}`,
  );
  return created.experienceId;
}

/** The audit rows of saves, not of the create that made the experience. */
async function auditOf(id: string) {
  const rows = await client.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.subjectId, id));
  return rows.filter((row) => row.action !== 'experience.created');
}

describe('updateGuideLinks', () => {
  it('keeps a change to another field that committed while the save waited for the lock, and audits only the links', async () => {
    const id = await guideEntry();

    const result = await race<
      Tx,
      Awaited<ReturnType<typeof editor.updateGuideLinks>>
    >(
      (body) => client.db.transaction(body),
      async (tx) => {
        await tx.execute(
          sql`SELECT id FROM experiences WHERE id = ${id} FOR UPDATE`,
        );
        await tx.execute(
          sql`UPDATE experiences SET description = 'Changed in another tab' WHERE id = ${id}`,
        );
      },
      () => editor.updateGuideLinks(ops, id, links),
    );

    expect(result).toEqual({ status: 'updated' });
    const view = await editor.readExperienceForOps(ops, id);
    expect(view?.content).toMatchObject({
      description: 'Changed in another tab',
      ...links,
    });
    const rows = await auditOf(id);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.details)).toContain('links');
    expect(JSON.stringify(rows[0]?.details)).not.toContain('description');
  });

  it('writes nothing when the links are the same', async () => {
    const id = await guideEntry();
    await editor.updateGuideLinks(ops, id, links);
    const before = (await auditOf(id)).length;

    expect(await editor.updateGuideLinks(ops, id, links)).toEqual({
      status: 'unchanged',
    });
    expect(await auditOf(id)).toHaveLength(before);
  });

  it('answers not_a_guide for an experience that is not guide-only and not_found for an unknown id', async () => {
    const id = await guideEntry();
    await client.db.execute(
      sql`UPDATE experiences SET status = 'draft' WHERE id = ${id}`,
    );

    expect(await editor.updateGuideLinks(ops, id, links)).toEqual({
      status: 'not_a_guide',
    });
    expect(await auditOf(id)).toEqual([]);
    expect(await editor.updateGuideLinks(ops, randomUUID(), links)).toEqual({
      status: 'not_found',
    });
  });

  it('refuses a caller who is not ops', async () => {
    const id = await guideEntry();

    await expect(
      editor.updateGuideLinks(testCaller({ userId: randomUUID() }), id, links),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await auditOf(id)).toEqual([]);
  });
});
