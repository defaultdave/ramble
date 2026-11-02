import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditLimits,
  exportManifestKey,
  exportPartKey,
  type AuditRow,
} from '@/lib/audit';
import { readAuditPage } from '@/server/db/audit';
import {
  createFakeStorageAdapter,
  type FakeStorageAdapter,
} from '@/server/ports/storage/fake';
import { StorageError } from '@/server/ports/storage';
import { createVercelBlobAdapter } from '@/server/ports/storage/vercel-blob';
import { exportAuditDay } from './auditExport';

vi.mock('@/server/db/audit', () => ({ readAuditPage: vi.fn() }));
vi.mock('@/server/db/client', () => ({ db: {} }));
const blob = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@vercel/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vercel/blob')>()),
  put: blob.put,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, against the fake store:
// - a day over a page long is written as numbered parts in id order, then a manifest with the totals
// - a day with no rows writes the manifest alone, so "no rows" is a recorded fact
// - a day that ends exactly on a full page writes no empty part
// - the reads ask for the day's window and continue from the last id written
// - a second run writes nothing new and succeeds; a run after a crash between parts completes the rest
// - a day that is not over, judged on the system clock, reads and writes nothing
// - a store failure fails the run and leaves no manifest
// - a day needing more parts than the limit fails and leaves no manifest
// - a store with no locked storage fails with a permanent refusal before any provider call, never reports success, and writes nothing

const day = '2026-10-31';
const now = new Date('2026-11-01T02:00:00Z');
const user = '3f2b8a40-5c1d-4e6f-9a7b-1c2d3e4f5a6b';
const subject = '7d1c9b1e-0a2b-4c3d-8e4f-5a6b7c8d9e0f';

const row = (id: number): AuditRow => ({
  id,
  recordedAt: new Date('2026-10-31T12:00:00Z'),
  actorKind: 'user',
  actorId: user,
  action: 'order.cancelled',
  subjectKind: 'order',
  subjectId: subject,
  details: {},
});

const pageSize = auditLimits.exportPageRows;

/** A day of `count` rows with ids 1..count, served the way the database serves them. */
function serveRows(count: number) {
  vi.mocked(readAuditPage).mockImplementation((_window, afterId, limit) =>
    Promise.resolve(
      Array.from(
        { length: Math.max(0, Math.min(limit, count - afterId)) },
        (_, index) => row(afterId + index + 1),
      ),
    ),
  );
}

const text = (storage: FakeStorageAdapter, key: string) => {
  const body = storage.read(key);
  return body === null ? null : new TextDecoder().decode(body);
};

let storage: FakeStorageAdapter;

beforeEach(() => {
  vi.useFakeTimers({ now });
  vi.mocked(readAuditPage).mockReset();
  storage = createFakeStorageAdapter({ now: () => now });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('exportAuditDay', () => {
  it('writes numbered parts in id order, then a manifest with the totals', async () => {
    serveRows(pageSize + 5);

    const tally = await exportAuditDay({ day }, storage);

    expect(tally).toEqual({
      parts: 2,
      rows: pageSize + 5,
      firstId: 1,
      lastId: pageSize + 5,
    });
    expect(
      text(storage, exportPartKey(day, 1))?.trim().split('\n'),
    ).toHaveLength(pageSize);
    const second =
      text(storage, exportPartKey(day, 2))?.trim().split('\n') ?? [];
    expect(
      second.map((line) => (JSON.parse(line) as { id: number }).id),
    ).toEqual([
      pageSize + 1,
      pageSize + 2,
      pageSize + 3,
      pageSize + 4,
      pageSize + 5,
    ]);
    expect(JSON.parse(text(storage, exportManifestKey(day)) ?? '')).toEqual({
      day,
      parts: 2,
      rows: pageSize + 5,
      firstId: 1,
      lastId: pageSize + 5,
    });
  });

  it('asks for the day window and continues from the last id written', async () => {
    serveRows(pageSize + 1);

    await exportAuditDay({ day }, storage);

    const window = {
      from: new Date('2026-10-31T00:00:00Z'),
      to: new Date('2026-11-01T00:00:00Z'),
    };
    expect(vi.mocked(readAuditPage).mock.calls).toEqual([
      [window, 0, pageSize],
      [window, pageSize, pageSize],
    ]);
  });

  it('writes the manifest alone for a day with no rows', async () => {
    serveRows(0);

    await exportAuditDay({ day }, storage);

    expect(storage.read(exportPartKey(day, 1))).toBeNull();
    expect(
      JSON.parse(text(storage, exportManifestKey(day)) ?? ''),
    ).toMatchObject({
      parts: 0,
      rows: 0,
      firstId: null,
    });
  });

  it('writes no empty part when the day ends on a full page', async () => {
    serveRows(pageSize);

    const tally = await exportAuditDay({ day }, storage);

    expect(tally.parts).toBe(1);
    expect(storage.read(exportPartKey(day, 2))).toBeNull();
  });

  it('succeeds again without changing what an earlier run wrote', async () => {
    serveRows(7);
    await exportAuditDay({ day }, storage);
    const before = text(storage, exportPartKey(day, 1));

    await expect(exportAuditDay({ day }, storage)).resolves.toMatchObject({
      rows: 7,
    });

    expect(text(storage, exportPartKey(day, 1))).toBe(before);
  });

  it('completes the rest after a crash between parts', async () => {
    serveRows(pageSize + 5);
    await storage.put({
      key: exportPartKey(day, 1),
      body: new TextEncoder().encode('earlier attempt\n'),
      contentType: 'application/x-ndjson',
    });

    await exportAuditDay({ day }, storage);

    expect(text(storage, exportPartKey(day, 1))).toBe('earlier attempt\n');
    expect(storage.read(exportPartKey(day, 2))).not.toBeNull();
    expect(storage.read(exportManifestKey(day))).not.toBeNull();
  });

  it('reads and writes nothing for a day that is not over', async () => {
    vi.setSystemTime(new Date('2026-11-01T00:59:59Z'));
    serveRows(3);

    await expect(exportAuditDay({ day }, storage)).rejects.toThrow(
      'not over yet',
    );

    expect(readAuditPage).not.toHaveBeenCalled();
    expect(storage.read(exportManifestKey(day))).toBeNull();
  });

  it('fails on a store failure and writes no manifest', async () => {
    serveRows(3);
    const failing = {
      ...storage,
      put: () => Promise.reject(new StorageError('provider_unavailable')),
    };

    await expect(exportAuditDay({ day }, failing)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });

    expect(storage.read(exportManifestKey(day))).toBeNull();
  });

  it('fails past the part limit and writes no manifest', async () => {
    serveRows(pageSize * (auditLimits.exportMaxParts + 1));

    await expect(exportAuditDay({ day }, storage)).rejects.toThrow(
      'more parts than the limit',
    );

    expect(
      storage.read(exportPartKey(day, auditLimits.exportMaxParts)),
    ).not.toBeNull();
    expect(storage.read(exportManifestKey(day))).toBeNull();
  });

  it('fails permanently on a store with no locked storage, calling no provider', async () => {
    serveRows(3);
    const unlocked = createVercelBlobAdapter({
      publicToken: 'public-token',
      privateToken: 'private-token',
      now: () => now,
    });

    await expect(exportAuditDay({ day }, unlocked)).rejects.toMatchObject({
      code: 'unsupported',
      permanent: true,
    });

    expect(blob.put).not.toHaveBeenCalled();
  });
});
