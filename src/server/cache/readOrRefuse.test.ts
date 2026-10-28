import { notFound } from 'next/navigation';
import { describe, expect, it } from 'vitest';
import { readOrRefuse } from './readOrRefuse';

// Behaviours under test, one per decision, branch or risk:
// - a read that succeeds returns its answer
// - a failed read throws only its own name and the kind of the failure, never the query, its values, or the cause
// - a thrown value that is not an Error is named unknown
// - a framework control-flow error passes through unchanged

// What a database error carries: the query text and the values bound to it.
const driverError = new Error(
  'Failed query: select ... where slug in ($1)\nparams: secret-slug,2026-11-07',
);

describe('readOrRefuse', () => {
  it('returns the answer of a read that succeeds', async () => {
    await expect(readOrRefuse('Home', () => Promise.resolve(7))).resolves.toBe(
      7,
    );
  });

  it('throws the kind of a failed read and not the query or its values', async () => {
    const failure = await readOrRefuse('Home', () =>
      Promise.reject(driverError),
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: 'CachedReadError',
      message: 'Home read failed: Error',
    });
    expect(JSON.stringify(failure)).not.toContain('secret-slug');
    expect((failure as Error).cause).toBeUndefined();
  });

  it('names a thrown value that is not an Error as unknown', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a driver can throw anything
      readOrRefuse('Home', () => Promise.reject('plain text')),
    ).rejects.toThrow('Home read failed: unknown');
  });

  it('passes a framework control-flow error through', async () => {
    await expect(
      readOrRefuse('Home', () => {
        notFound();
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') as string,
    });
  });
});
