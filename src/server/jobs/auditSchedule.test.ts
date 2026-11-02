import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/server/db/client';
import { readFirstAuditTime } from '@/server/db/audit';
import { logger } from '@/server/monitoring/logger';
import type { StoragePort } from '@/server/ports/storage';
import { enqueue } from './enqueue';
import { scheduleAuditExports } from './auditSchedule';

const tx = {} as Transaction;

vi.mock('@/server/db/client', () => ({
  db: { transaction: (run: (tx: unknown) => unknown) => run(tx) },
}));
vi.mock('@/server/db/audit', () => ({ readFirstAuditTime: vi.fn() }));
vi.mock('./enqueue', () => ({ enqueue: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/ports/storage/config', () => ({
  getStorage: () => ({ provider: 'fake', storesAudit: true }),
}));

// Behaviours under test:
// - an empty log queues nothing
// - each ready day from the first row is queued with its own kind, payload and dedupe key, oldest first, in one transaction
// - the count is the days that were new: a dedupe key already used adds nothing
// - on a provider with no locked store nothing is queued, and one warning says the export is off, but only when there are days to export

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T12:00:00Z') });
  vi.mocked(enqueue).mockReset().mockResolvedValue({ id: 'job' });
  vi.mocked(readFirstAuditTime).mockReset();
  vi.mocked(logger.warn).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const unlocked = {
  provider: 'vercel-blob',
  storesAudit: false,
} as StoragePort;

describe('scheduleAuditExports', () => {
  it('queues nothing for an empty log', async () => {
    vi.mocked(readFirstAuditTime).mockResolvedValue(null);

    await expect(scheduleAuditExports()).resolves.toBe(0);

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('queues each ready day from the first row with its own dedupe key', async () => {
    vi.mocked(readFirstAuditTime).mockResolvedValue(
      new Date('2026-11-03T08:00:00Z'),
    );

    await expect(scheduleAuditExports()).resolves.toBe(2);

    expect(vi.mocked(enqueue).mock.calls).toEqual([
      [
        tx,
        {
          kind: 'audit-export',
          payload: { day: '2026-11-03' },
          dedupeKey: 'audit-export:2026-11-03',
        },
      ],
      [
        tx,
        {
          kind: 'audit-export',
          payload: { day: '2026-11-04' },
          dedupeKey: 'audit-export:2026-11-04',
        },
      ],
    ]);
  });

  it('counts only the days that were new', async () => {
    vi.mocked(readFirstAuditTime).mockResolvedValue(
      new Date('2026-11-03T08:00:00Z'),
    );
    vi.mocked(enqueue).mockResolvedValueOnce(null);

    await expect(scheduleAuditExports()).resolves.toBe(1);
  });

  it('queues nothing and warns once on a provider with no locked store', async () => {
    vi.mocked(readFirstAuditTime).mockResolvedValue(
      new Date('2026-11-03T08:00:00Z'),
    );

    await expect(scheduleAuditExports(unlocked)).resolves.toBe(0);

    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'audit export is off: no locked store is configured for this provider',
      { provider: 'vercel-blob' },
    );
  });

  it('does not warn on a provider with no locked store while the log is empty', async () => {
    vi.mocked(readFirstAuditTime).mockResolvedValue(null);

    await expect(scheduleAuditExports(unlocked)).resolves.toBe(0);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
