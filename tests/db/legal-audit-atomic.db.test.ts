import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuditEntryInput } from '@/lib/audit';
import { legalAuditEntry } from '@/lib/editorialLegal';
import type { LegalDocument } from '@/lib/legal';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { auditLog, legalDocuments } from '@/server/db/schema';
import { id as uuid } from '../support/ids';
import { doc } from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - createLegalDraft, editLegalDraft and publishLegalDocument write their audit row in the same
//   transaction as the change: when the audit write fails, the change is rolled back
// - on success each writes the change and exactly one audit row naming the written version
// - a write given no audit entry builder writes no audit row (the seed's path), and a result that
//   changed nothing never asks for an entry

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
const actor = uuid(7);

/** An entry the audit table's schema refuses, so the audit write throws after the change was made. */
const refusedEntry = (document: LegalDocument): AuditEntryInput => ({
  ...legalAuditEntry(actor, 'drafted', document),
  action: '',
});

const auditRowsFor = async (action: string, subjectId: string) =>
  (
    await client.db.select().from(auditLog).where(eq(auditLog.action, action))
  ).filter((row) => row.subjectId === subjectId);

const versionsOf = (key: string) =>
  client.db.select().from(legalDocuments).where(eq(legalDocuments.doc, key));

const draftOf = (key: string, title = 'Title') =>
  legal.createLegalDraft(ops, { doc: key, title, body: doc() });

describe('createLegalDraft with an audit entry', () => {
  it('writes the draft and one audit row', async () => {
    const created = await legal.createLegalDraft(
      ops,
      { doc: 'waiver-audit-create', title: 'T', body: doc() },
      (document) => legalAuditEntry(actor, 'drafted', document),
    );

    const rows = await auditRowsFor('legal_document.drafted', created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: actor,
      subjectKind: 'legal_document',
      details: { doc: 'waiver-audit-create', version: 1 },
    });
  });

  it('writes no draft when the audit write fails', async () => {
    await expect(
      legal.createLegalDraft(
        ops,
        { doc: 'waiver-audit-create-fail', title: 'T', body: doc() },
        refusedEntry,
      ),
    ).rejects.toThrow();

    expect(await versionsOf('waiver-audit-create-fail')).toEqual([]);
  });

  it('writes no audit row when given no entry', async () => {
    const created = await draftOf('waiver-audit-create-none');

    expect(await auditRowsFor('legal_document.drafted', created.id)).toEqual(
      [],
    );
  });
});

describe('editLegalDraft with an audit entry', () => {
  it('saves the edit and writes one audit row', async () => {
    const draft = await draftOf('waiver-audit-edit');

    const result = await legal.editLegalDraft(
      ops,
      draft.id,
      { title: 'Edited', body: doc() },
      (document) => legalAuditEntry(actor, 'edited', document),
    );

    expect(result).toMatchObject({
      status: 'saved',
      value: { title: 'Edited' },
    });
    const rows = await auditRowsFor('legal_document.edited', draft.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ details: { doc: draft.doc, version: 1 } });
  });

  it('leaves the draft unchanged when the audit write fails', async () => {
    const draft = await draftOf('waiver-audit-edit-fail', 'Before');

    await expect(
      legal.editLegalDraft(
        ops,
        draft.id,
        { title: 'After', body: doc() },
        refusedEntry,
      ),
    ).rejects.toThrow();

    const [row] = await versionsOf('waiver-audit-edit-fail');
    expect(row?.title).toBe('Before');
  });

  it('asks for no entry for a version that is not a draft', async () => {
    const draft = await draftOf('waiver-audit-edit-final');
    await legal.publishLegalDocument(ops, draft.id);
    const build = vi.fn((document: LegalDocument) =>
      legalAuditEntry(actor, 'edited', document),
    );

    const result = await legal.editLegalDraft(
      ops,
      draft.id,
      { title: 'Late', body: doc() },
      build,
    );

    expect(result).toEqual({ status: 'not_a_draft' });
    expect(build).not.toHaveBeenCalled();
    expect(await auditRowsFor('legal_document.edited', draft.id)).toEqual([]);
  });
});

describe('publishLegalDocument with an audit entry', () => {
  it('publishes and writes one audit row', async () => {
    const draft = await draftOf('waiver-audit-publish');

    const result = await legal.publishLegalDocument(ops, draft.id, (document) =>
      legalAuditEntry(actor, 'published', document),
    );

    expect(result).toMatchObject({ status: 'published' });
    const rows = await auditRowsFor('legal_document.published', draft.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ details: { doc: draft.doc, version: 1 } });
  });

  it('leaves the draft unpublished when the audit write fails', async () => {
    const draft = await draftOf('waiver-audit-publish-fail');

    await expect(
      legal.publishLegalDocument(ops, draft.id, refusedEntry),
    ).rejects.toThrow();

    const [row] = await versionsOf('waiver-audit-publish-fail');
    expect(row).toMatchObject({ status: 'draft', publishedAt: null });
  });

  it('asks for no entry for a draft that is superseded', async () => {
    const lower = await draftOf('waiver-audit-publish-old');
    const higher = await legal.createLegalDraft(ops, {
      doc: 'waiver-audit-publish-old',
      title: 'v2',
      body: doc(),
    });
    await legal.publishLegalDocument(ops, higher.id);
    const build = vi.fn((document: LegalDocument) =>
      legalAuditEntry(actor, 'published', document),
    );

    const result = await legal.publishLegalDocument(ops, lower.id, build);

    expect(result).toEqual({ status: 'superseded' });
    expect(build).not.toHaveBeenCalled();
  });
});
