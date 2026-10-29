import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction, db } from '@/server/db/client';
import { insertJob } from '@/server/db/jobs';
import { enqueue } from './enqueue';
import { findJob, jobRegistry, type JobRegistry } from './registry';

vi.mock('@/server/db/jobs', () => ({ insertJob: vi.fn() }));

// Behaviours under test:
// - a known kind with a valid payload is written once, with the kind's max attempts, and returns the new id
// - the payload written is the schema's parsed output (unknown keys stripped by the kind's schema)
// - an unknown kind, a kind named like an inherited property, a bad kind shape, or a bad dedupe key throws and writes nothing
// - a payload the kind's schema refuses, or one over 16 KB, throws and writes nothing
// - a dedupe key already used returns null

const tx = {} as Transaction;
const registry = {
  big: {
    payload: z.object({ text: z.string() }),
    maxAttempts: 5,
    handleIdempotent: async () => {},
  },
  strip: {
    payload: z.object({ keep: z.string() }),
    maxAttempts: 2,
    handleIdempotent: async () => {},
  },
} satisfies JobRegistry;

beforeEach(() => {
  vi.mocked(insertJob).mockReset().mockResolvedValue({ id: 'new-id' });
});

describe('enqueue', () => {
  it('writes a valid job with the kind max attempts and returns its id', async () => {
    const runAfter = new Date('2026-12-01T00:00:00Z');

    const result = await enqueue(
      tx,
      { kind: 'big', payload: { text: 'hi' }, dedupeKey: 'order:1', runAfter },
      registry,
    );

    expect(result).toEqual({ id: 'new-id' });
    expect(insertJob).toHaveBeenCalledExactlyOnceWith(tx, {
      kind: 'big',
      payload: { text: 'hi' },
      dedupeKey: 'order:1',
      maxAttempts: 5,
      runAfter,
    });
  });

  it('writes the parsed payload', async () => {
    await enqueue(
      tx,
      { kind: 'strip', payload: { keep: 'a', extra: 1 } },
      registry,
    );

    expect(vi.mocked(insertJob).mock.calls[0]?.[1].payload).toEqual({
      keep: 'a',
    });
  });

  it('writes the shipped noop kind', async () => {
    await enqueue(tx, { kind: 'noop', payload: {} });

    expect(insertJob).toHaveBeenCalledOnce();
  });

  it.each([
    ['an unknown kind', { kind: 'missing', payload: {} }],
    [
      'a kind named like an inherited property',
      { kind: 'constructor', payload: {} },
    ],
    ['a kind that is not kebab case', { kind: 'Big', payload: { text: 'a' } }],
    ['an over-long kind', { kind: 'a'.repeat(65), payload: {} }],
    [
      'a bad dedupe key',
      { kind: 'big', payload: { text: 'a' }, dedupeKey: 'has space' },
    ],
    ['a payload the schema refuses', { kind: 'big', payload: { text: 1 } }],
    ['a missing payload', { kind: 'big', payload: undefined }],
    [
      'a payload over 16 KB',
      { kind: 'big', payload: { text: 'x'.repeat(16 * 1024) } },
    ],
  ])('throws and writes nothing for %s', async (_name, input) => {
    await expect(enqueue(tx, input, registry)).rejects.toThrow();

    expect(insertJob).not.toHaveBeenCalled();
  });

  it('accepts a payload exactly at 16 KB', async () => {
    await enqueue(
      tx,
      { kind: 'big', payload: { text: 'x'.repeat(16 * 1024 - 11) } },
      registry,
    );

    expect(insertJob).toHaveBeenCalledOnce();
  });

  it('returns null when the dedupe key was already used', async () => {
    vi.mocked(insertJob).mockResolvedValue(null);

    await expect(
      enqueue(
        tx,
        { kind: 'big', payload: { text: 'a' }, dedupeKey: 'k' },
        registry,
      ),
    ).resolves.toBeNull();
  });
});

describe('registry', () => {
  it('finds only own keys', () => {
    expect(findJob(jobRegistry, 'noop')).toBeDefined();
    expect(findJob(jobRegistry, 'toString')).toBeUndefined();
    expect(findJob(jobRegistry, '__proto__')).toBeUndefined();
  });
});

describe('enqueue types', () => {
  it('accepts a transaction and not the plain database handle', () => {
    const useHandle = (handle: typeof db) =>
      // @ts-expect-error a job must be written in the caller's transaction, never on the bare handle
      enqueue(handle, { kind: 'noop', payload: {} });

    expect(useHandle).toBeTypeOf('function');
  });
});
