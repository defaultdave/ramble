import { randomUUID } from 'node:crypto';
import { updateTag } from 'next/cache';
import { asc, eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { PageCopyInput } from '@/lib/editorial';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { auditLog } from '@/server/db/schema';
import { doc, editorialFixtures } from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, against the real database, one per decision, branch or risk:
// Page copy:
// - every save writes one audit row in the same transaction: created, saved, published, unpublished, naming the user and the page and holding no words
// - a save from a stale tab keeps the stored status, so a draft cannot unpublish what another tab published
// - publish and unpublish clear the term's tag, and a draft saved over a draft clears nothing
// - an unknown target writes no audit row
// Legal documents:
// - starting, editing and publishing a version each write one audit row after the write, naming the document key and version and no words
// - a version that is final, a draft that is gone and a draft below a published version write no audit row
// - the list of documents counts each key's versions and names its newest and its newest published
// - every function refuses a guest, a host owner and nobody, and writes nothing

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');
let legalAdmin: typeof import('@/server/db/legalAdmin');
let legal: typeof import('@/server/db/legal');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
  legalAdmin = await import('@/server/db/legalAdmin');
  legal = await import('@/server/db/legal');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.mocked(updateTag).mockClear();
});

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });
const tagsUpdated = () => vi.mocked(updateTag).mock.calls.map(([tag]) => tag);
const { insertCategory } = editorialFixtures(() => client.db);

async function auditFor(subjectId: string) {
  return client.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.subjectId, subjectId))
    .orderBy(asc(auditLog.id));
}

describe('saving page copy', () => {
  const input = (
    targetId: string,
    overrides: Partial<PageCopyInput> = {},
  ): PageCopyInput => ({
    kind: 'category',
    targetId,
    heading: 'Secret heading words',
    metaDescription: null,
    status: 'draft',
    intro: doc('Intro words'),
    body: null,
    ...overrides,
  });

  async function saved(...args: Parameters<typeof editorial.savePageCopy>) {
    const result = await editorial.savePageCopy(...args);
    if (result.status !== 'saved') throw new Error('expected a save');
    return result.value;
  }

  it('writes one audit row per save, in order, naming the user and the page and no words', async () => {
    const category = await insertCategory();
    const first = await saved(ops, input(category.id));
    await saved(ops, input(category.id), 'save');
    await saved(ops, input(category.id), 'publish');
    await saved(ops, input(category.id), 'save');
    await saved(ops, input(category.id), 'unpublish');

    const rows = await auditFor(first.id);
    expect(rows.map((row) => row.action)).toEqual([
      'page_copy.created',
      'page_copy.saved',
      'page_copy.published',
      'page_copy.saved',
      'page_copy.unpublished',
    ]);
    expect(rows[0]).toMatchObject({
      actorKind: 'user',
      actorId: opsUser,
      subjectKind: 'page_copy',
    });
    expect(JSON.stringify(rows)).not.toContain('words');
  });

  it('keeps the stored status when a stale tab saves its draft', async () => {
    const category = await insertCategory();
    await saved(ops, input(category.id, { status: 'published' }), 'publish');

    const stale = await saved(
      ops,
      input(category.id, { heading: 'Edited in the old tab' }),
      'save',
    );

    expect(stale).toMatchObject({
      status: 'published',
      heading: 'Edited in the old tab',
    });
  });

  it('clears the tag of the page on publish and unpublish, and none for a draft over a draft', async () => {
    const category = await insertCategory();
    await saved(ops, input(category.id), 'save');
    expect(tagsUpdated()).toEqual([]);

    await saved(ops, input(category.id), 'publish');
    expect(tagsUpdated()).toEqual([`category:${category.slug}`]);

    vi.mocked(updateTag).mockClear();
    await saved(ops, input(category.id), 'unpublish');
    expect(tagsUpdated()).toEqual([`category:${category.slug}`]);
  });

  it('writes no audit row for a target that is not there', async () => {
    const target = randomUUID();

    const result = await editorial.savePageCopy(ops, input(target), 'save');

    expect(result).toEqual({ status: 'unknown_target' });
    expect(await auditFor(target)).toEqual([]);
  });
});

describe('the legal documents', () => {
  const draftOf = (docKey: string, title = 'Secret title words') => ({
    doc: docKey,
    title,
    body: doc('Secret body words'),
  });

  async function started(docKey: string) {
    const result = await legalAdmin.startLegalDraft(ops, draftOf(docKey));
    if (result.status !== 'drafted') throw new Error('expected a draft');
    return result.value;
  }

  it('audits a started draft, an edit and a publish, with the key and version and no words', async () => {
    const draft = await started('privacy');
    const edited = await legalAdmin.saveLegalDraft(ops, draft.id, {
      title: 'Edited title words',
      body: doc('Edited body words'),
    });
    const published = await legalAdmin.publishLegalDraft(ops, draft.id);

    expect(edited.status).toBe('saved');
    expect(published.status).toBe('published');
    const rows = await auditFor(draft.id);
    expect(rows.map((row) => row.action)).toEqual([
      'legal_document.drafted',
      'legal_document.edited',
      'legal_document.published',
    ]);
    expect(rows[0]).toMatchObject({
      actorId: opsUser,
      subjectKind: 'legal_document',
      details: { doc: 'privacy', version: 1 },
    });
    expect(JSON.stringify(rows)).not.toContain('words');
    expect(tagsUpdated()).toContain('legal:privacy');
  });

  it('writes no audit row for a version that is final, a draft that is gone, or one below a published version', async () => {
    const first = await started('host-agreement');
    const second = await started('host-agreement');
    await legalAdmin.publishLegalDraft(ops, second.id);
    const rowsBefore = (await client.db.select().from(auditLog)).length;

    const superseded = await legalAdmin.publishLegalDraft(ops, first.id);
    const final = await legalAdmin.saveLegalDraft(ops, second.id, {
      title: 'Too late',
      body: doc(),
    });
    const gone = await legalAdmin.publishLegalDraft(ops, randomUUID());

    expect(superseded.status).toBe('superseded');
    expect(final.status).toBe('not_a_draft');
    expect(gone.status).toBe('not_a_draft');
    expect(await client.db.select().from(auditLog)).toHaveLength(rowsBefore);
  });

  it('lists each key once with its counts, newest and newest published', async () => {
    const one = await legal.createLegalDraft(ops, draftOf('waiver-kayak'));
    await legalAdmin.publishLegalDraft(ops, one.id);
    await started('waiver-kayak');

    const summaries = await legalAdmin.listLegalDocSummaries(ops);

    expect(summaries.find((row) => row.doc === 'waiver-kayak')).toEqual({
      doc: 'waiver-kayak',
      versions: 2,
      latestVersion: 2,
      publishedVersion: 1,
    });
  });

  it('refuses to start a draft of a key no document has, and starts one for a waiver that has a version', async () => {
    const rowsBefore = (await client.db.select().from(auditLog)).length;

    expect(
      await legalAdmin.startLegalDraft(ops, draftOf('waiver-nothing-here')),
    ).toEqual({ status: 'unknown_document' });
    expect(await client.db.select().from(auditLog)).toHaveLength(rowsBefore);

    await legal.createLegalDraft(ops, draftOf('waiver-has-one'));
    const next = await legalAdmin.startLegalDraft(
      ops,
      draftOf('waiver-has-one'),
    );
    expect(next.status).toBe('drafted');
  });

  it.each([
    ['a guest', testCaller({ userId: randomUUID() })],
    [
      'a host owner',
      testCaller({
        userId: randomUUID(),
        roles: [Role.HostOwner],
        hostIds: [randomUUID()],
      }),
    ],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ] as const)(
    'refuses %s everywhere and writes nothing',
    async (_who, caller) => {
      const rowsBefore = (await client.db.select().from(auditLog)).length;
      const calls = [
        () => legalAdmin.listLegalDocSummaries(caller),
        () => legalAdmin.startLegalDraft(caller, draftOf('terms')),
        () =>
          legalAdmin.saveLegalDraft(caller, randomUUID(), {
            title: 'T',
            body: doc(),
          }),
        () => legalAdmin.publishLegalDraft(caller, randomUUID()),
      ];

      for (const call of calls) {
        await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await client.db.select().from(auditLog)).toHaveLength(rowsBefore);
    },
  );
});
