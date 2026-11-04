import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { editorialLimits } from '@/lib/editorial';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { legalAcceptances, legalDocuments } from '@/server/db/schema';
import { id as uuid } from '../support/ids';
import { doc, editorialFixtures, insertOne } from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - a published legal version cannot be edited, deleted, re-keyed, or published under a newer one;
//   an acceptance names a published version only, is unique per subject and version, and never changes
// - an experience can name a legal document as its waiver, and an unknown one is refused
// - the publish lookup in publishLegalDocument sees a published version however many exist

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let legal: typeof import('@/server/db/legal');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  legal = await import('@/server/db/legal');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const ops = testCaller({ roles: [Role.Ops] });

const { insertExperience } = editorialFixtures(() => client.db);

/** The only way a published row exists: written as a draft, then published, as the guard requires. */
async function insertPublishedLegal(values: Record<string, unknown>) {
  const draft = await insertOne(
    client.db
      .insert(legalDocuments)
      .values({ ...values, status: 'draft', publishedAt: null } as never)
      .returning(),
  );
  return insertOne(
    client.db
      .update(legalDocuments)
      .set({
        status: 'published',
        publishedAt: new Date('2026-10-01T00:00:00Z'),
      })
      .where(eq(legalDocuments.id, draft.id))
      .returning(),
  );
}

describe('legal documents and acceptances in the database', () => {
  const version = (overrides: Record<string, unknown> = {}) => ({
    doc: 'terms',
    version: 1,
    title: 'Terms',
    body: doc(),
    ...overrides,
  });

  it.each([
    ['a capitalised key', { doc: 'Terms' }, 'legal_documents_doc_key'],
    ['a bare waiver key', { doc: 'waiver' }, 'legal_documents_doc_key'],
    ['an unknown key', { doc: 'cookies' }, 'legal_documents_doc_key'],
    [
      'a key over the length limit',
      { doc: `waiver-${'a'.repeat(editorialLimits.slug)}` },
      'legal_documents_doc_key',
    ],
    ['version zero', { version: 0 }, 'legal_documents_version_positive'],
    ['a blank title', { title: ' ' }, 'legal_documents_title'],
    [
      'a body that is a list',
      { body: [] },
      'legal_documents_body_is_rich_text',
    ],
    [
      'a body whose root is not a doc node',
      { body: { type: 'paragraph', content: [] } },
      'legal_documents_body_is_rich_text',
    ],
    [
      'a body with no root type',
      { body: { content: [] } },
      'legal_documents_body_is_rich_text',
    ],
    [
      'a body with no content',
      { body: { type: 'doc' } },
      'legal_documents_body_is_rich_text',
    ],
    [
      'a draft with a publication time',
      { publishedAt: new Date('2026-10-01T00:00:00Z') },
      'legal_documents_published_at_matches_status',
    ],
  ])('refuse %s', async (_name, change, constraint) => {
    await expect(
      client.db.insert(legalDocuments).values(version(change) as never),
    ).rejects.toMatchObject({ cause: { constraint } });
  });

  it('refuse a version number used twice for one document', async () => {
    await client.db
      .insert(legalDocuments)
      .values(version({ doc: 'waiver-dup' }) as never);

    await expect(
      client.db
        .insert(legalDocuments)
        .values(version({ doc: 'waiver-dup' }) as never),
    ).rejects.toMatchObject({
      cause: { constraint: 'legal_documents_doc_version_unique' },
    });
  });

  describe('a version written as published', () => {
    const asPublished = (overrides: Record<string, unknown>) =>
      client.db.insert(legalDocuments).values(
        version({
          status: 'published',
          publishedAt: new Date('2026-10-01T00:00:00Z'),
          ...overrides,
        }) as never,
      );

    it('is refused when nothing is published yet', async () => {
      await expect(
        asPublished({ doc: 'waiver-insert-first' }),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining('starts as a draft') as string,
        },
      });
    });

    it('is refused below the current version and when back-dated', async () => {
      await insertPublishedLegal(
        version({ doc: 'waiver-insert-below', version: 5 }),
      );

      await expect(
        asPublished({ doc: 'waiver-insert-below', version: 3 }),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining('starts as a draft') as string,
        },
      });
      await expect(
        asPublished({
          doc: 'waiver-insert-below',
          version: 6,
          publishedAt: new Date('2001-01-01T00:00:00Z'),
        }),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining('starts as a draft') as string,
        },
      });
    });
  });

  describe('a published version', () => {
    let publishedId: string;

    beforeAll(async () => {
      publishedId = (
        await insertPublishedLegal(version({ doc: 'privacy', version: 1 }))
      ).id;
    });

    it.each([
      [
        'edited',
        () =>
          client.db
            .update(legalDocuments)
            .set({ title: 'Changed' })
            .where(eq(legalDocuments.id, publishedId)),
      ],
      [
        'unpublished',
        () =>
          client.db
            .update(legalDocuments)
            .set({ status: 'draft', publishedAt: null })
            .where(eq(legalDocuments.id, publishedId)),
      ],
      [
        'deleted',
        () =>
          client.db
            .delete(legalDocuments)
            .where(eq(legalDocuments.id, publishedId)),
      ],
    ])('cannot be %s', async (_name, attempt) => {
      await expect(attempt()).rejects.toMatchObject({
        cause: { message: expect.stringContaining('is final') as string },
      });
    });
  });

  describe('a draft', () => {
    it('can be edited and deleted, but not re-keyed or renumbered', async () => {
      const draft = await insertOne(
        client.db
          .insert(legalDocuments)
          .values(version({ doc: 'waiver-draft-rules' }) as never)
          .returning(),
      );

      await client.db
        .update(legalDocuments)
        .set({ title: 'Edited' })
        .where(eq(legalDocuments.id, draft.id));
      for (const change of [{ doc: 'waiver-other' }, { version: 2 }]) {
        await expect(
          client.db
            .update(legalDocuments)
            .set(change)
            .where(eq(legalDocuments.id, draft.id)),
        ).rejects.toMatchObject({
          cause: {
            message: expect.stringContaining('keeps its document') as string,
          },
        });
      }
      await client.db
        .delete(legalDocuments)
        .where(eq(legalDocuments.id, draft.id));
    });

    it('cannot be published under a newer published version', async () => {
      const older = await insertOne(
        client.db
          .insert(legalDocuments)
          .values(version({ doc: 'waiver-order', version: 1 }) as never)
          .returning(),
      );
      await insertPublishedLegal(version({ doc: 'waiver-order', version: 2 }));

      await expect(
        client.db
          .update(legalDocuments)
          .set({
            status: 'published',
            publishedAt: new Date('2026-10-02T00:00:00Z'),
          })
          .where(eq(legalDocuments.id, older.id)),
      ).rejects.toMatchObject({
        cause: { message: expect.stringContaining('newer version') as string },
      });
    });
  });

  describe('an acceptance', () => {
    let publishedId: string;
    let draftId: string;

    beforeAll(async () => {
      publishedId = (
        await insertPublishedLegal(version({ doc: 'host-agreement' }))
      ).id;
      draftId = (
        await insertOne(
          client.db
            .insert(legalDocuments)
            .values(version({ doc: 'host-agreement', version: 2 }) as never)
            .returning(),
        )
      ).id;
    });

    it('cannot name a draft', async () => {
      await expect(
        client.db.insert(legalAcceptances).values({
          legalDocumentId: draftId,
          subjectKind: 'host',
          subjectId: uuid(1),
        }),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining(
            'Only a published version',
          ) as string,
        },
      });
    });

    it('cannot name a document that does not exist', async () => {
      await expect(
        client.db.insert(legalAcceptances).values({
          legalDocumentId: uuid(404),
          subjectKind: 'host',
          subjectId: uuid(1),
        }),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining(
            'Only a published version',
          ) as string,
        },
      });
    });

    it('is written once per subject and version, and never changes', async () => {
      const row = {
        legalDocumentId: publishedId,
        subjectKind: 'order' as const,
        subjectId: uuid(2),
      };
      const accepted = await insertOne(
        client.db.insert(legalAcceptances).values(row).returning(),
      );

      await expect(
        client.db.insert(legalAcceptances).values(row),
      ).rejects.toMatchObject({
        cause: { constraint: 'legal_acceptances_once_per_subject' },
      });
      await expect(
        client.db
          .update(legalAcceptances)
          .set({ subjectId: uuid(3) })
          .where(eq(legalAcceptances.id, accepted.id)),
      ).rejects.toMatchObject({
        cause: { message: expect.stringContaining('never changes') as string },
      });
      await expect(
        client.db
          .delete(legalAcceptances)
          .where(eq(legalAcceptances.id, accepted.id)),
      ).rejects.toMatchObject({
        cause: { message: expect.stringContaining('never changes') as string },
      });
    });

    it('keeps its version from being deleted', async () => {
      await expect(
        client.db
          .delete(legalDocuments)
          .where(eq(legalDocuments.id, publishedId)),
      ).rejects.toMatchObject({ cause: { code: '23001' } });
    });
  });

  it('can be the waiver of an experience, and an unknown document is refused', async () => {
    const waiver = await insertPublishedLegal(version({ doc: 'waiver-kayak' }));

    const experience = await insertExperience('live', {
      waiverRequired: true,
      waiverDocumentId: waiver.id,
    });

    expect(experience.waiverDocumentId).toBe(waiver.id);
    await expect(
      insertExperience('live', { waiverDocumentId: uuid(404) }),
    ).rejects.toMatchObject({
      cause: {
        constraint: 'experiences_waiver_document_id_legal_documents_id_fk',
      },
    });
  });
});

describe('the publish lookup in publishLegalDocument', () => {
  const insertDrafts = (doc: string, count: number) =>
    client.db.execute(
      sql`INSERT INTO legal_documents (doc, version, title, body)
        SELECT ${doc}, g, 'T', '{"type":"doc","content":[]}'::jsonb
        FROM generate_series(1, ${count}::int) AS g`,
    );

  // One statement, in order, so each version publishes above the ones before it.
  const publishVersions = (doc: string, versions: readonly number[]) =>
    client.db.execute(
      sql`DO $$
        DECLARE v int;
        BEGIN
          FOREACH v IN ARRAY ${sql.raw(`ARRAY[${versions.join(',')}]`)} LOOP
            UPDATE legal_documents SET status = 'published'
              WHERE doc = ${sql.raw(`'${doc}'`)} AND version = v;
          END LOOP;
        END
        $$`,
    );

  const idOf = async (doc: string, version: number) => {
    const [row] = await client.db
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(
        and(eq(legalDocuments.doc, doc), eq(legalDocuments.version, version)),
      );
    if (!row) throw new Error('missing version');
    return row.id;
  };

  it('publishes a lower draft while the higher version is only a draft', async () => {
    const lower = await legal.createLegalDraft(ops, {
      doc: 'waiver-draft-above',
      title: 'v1',
      body: doc(),
    });
    await legal.createLegalDraft(ops, {
      doc: 'waiver-draft-above',
      title: 'v2',
      body: doc(),
    });

    const result = await legal.publishLegalDocument(ops, lower.id);

    expect(result).toMatchObject({
      status: 'published',
      value: { version: 1 },
    });
  });

  it('sees a published version above the draft however many are published, and in any position', async () => {
    const key = 'waiver-cap-order';
    await insertDrafts(key, 203);
    const published = [...Array.from({ length: 200 }, (_, n) => n + 2), 203];
    await publishVersions(key, published);
    expect(published.length).toBeGreaterThan(editorialLimits.listed);

    // 1 has published versions above it; 202 has 200 below it and only 203 above, which a lookup
    // that took the lowest 200 would never see.
    for (const version of [1, 202]) {
      expect(
        await legal.publishLegalDocument(ops, await idOf(key, version)),
      ).toEqual({ status: 'superseded' });
    }
  });
});
