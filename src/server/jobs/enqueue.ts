import 'server-only';
import { EnqueueInputSchema, payloadFits } from '@/lib/jobs';
import type { Transaction } from '@/server/db/client';
import { insertJob } from '@/server/db/jobs';
import { findJob, jobRegistry, type JobRegistry } from './registry';

export type EnqueueInput = {
  kind: string;
  payload: unknown;
  /** A second enqueue of the same key writes nothing, so a retried action does not double-enqueue. */
  dedupeKey?: string;
  runAfter?: Date;
};

/**
 * Writes a job in the caller's transaction, so it exists exactly when the change it belongs to
 * does. The parameter type accepts a transaction only; the plain `db` handle does not fit.
 *
 * Throws, and writes nothing, on an unknown kind, a payload the kind's schema refuses, or a
 * payload over 16 KB. Returns the new job's ID, or null when the dedupe key was already used (the
 * key stays used after the job finishes).
 */
// TODO(U-049): first caller, confirmOrder enqueues the booking email jobs.
export async function enqueue(
  tx: Transaction,
  input: EnqueueInput,
  registry: JobRegistry = jobRegistry,
): Promise<{ id: string } | null> {
  const { kind, dedupeKey, runAfter } = EnqueueInputSchema.parse(input);
  const definition = findJob(registry, kind);
  if (!definition) throw new Error(`Unknown job kind "${kind}"`);
  const payload: unknown = definition.payload.parse(input.payload);
  if (!payloadFits(payload)) {
    throw new Error(`Payload for job kind "${kind}" is over the size limit`);
  }
  return insertJob(tx, {
    kind,
    payload,
    dedupeKey,
    maxAttempts: definition.maxAttempts,
    runAfter,
  });
}
