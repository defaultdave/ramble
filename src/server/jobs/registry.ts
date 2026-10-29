import 'server-only';
import { z } from 'zod';
import { MaxAttemptsSchema, jobLimits } from '@/lib/jobs';
import {
  ProcessProviderEventPayloadSchema,
  processProviderEventKind,
} from '@/lib/providerEvents';
import type { Transaction } from '@/server/db/client';
import type { Clock } from '@/server/ports/clock';
import {
  BookingEmailPayloadSchema,
  sendGuestConfirmation,
  sendHostBookingNotice,
} from './bookingEmails';
import { handleProviderEvent, prepareProviderEvent } from './providerEvents';

type JobContext<Payload> = {
  /** The transaction the job's own writes belong to; it rolls back if the handler throws. */
  tx: Transaction;
  payload: Payload;
  /** What the definition's `prepare` returned, or undefined when it has none. */
  prepared: unknown;
  /** Stable across retries: use it as the idempotency key for any provider call. */
  jobId: string;
  clock: Clock;
};

/**
 * Delivery is at least once: a crash after a provider call but before the commit runs the job
 * again. A handler must therefore be safe to run twice for the same job ID.
 */
type IdempotentJobHandler<Payload> = (
  context: JobContext<Payload>,
) => Promise<void>;

export type JobDefinition<Schema extends z.ZodType = z.ZodType> = {
  payload: Schema;
  maxAttempts: number;
  /**
   * Runs before the job's transaction opens, for a call that must not hold a connection open (a
   * provider lookup). A throw is a failed try like a handler's. Its result reaches the handler.
   */
  prepare?: (payload: z.output<Schema>) => Promise<unknown>;
  handleIdempotent: IdempotentJobHandler<z.output<Schema>>;
};

export type JobRegistry = Record<string, JobDefinition>;

/** Checks the attempts bound at definition time, so a bad entry fails at import and not at the first enqueue. */
function defineJob<Schema extends z.ZodType>(
  definition: JobDefinition<Schema>,
): JobDefinition {
  MaxAttemptsSchema.parse(definition.maxAttempts);
  return definition;
}

/**
 * Looks a kind up as an own key, so a kind named like an inherited property (`constructor`) is
 * unknown instead of resolving to something on the prototype.
 */
export function findJob(
  registry: JobRegistry,
  kind: string,
): JobDefinition | undefined {
  return Object.hasOwn(registry, kind) ? registry[kind] : undefined;
}

/**
 * Every kind of job. A later unit adds an entry and its handler here; the table needs no change.
 * Handlers for reminders, gift delivery, transfers, and provider events belong to those units.
 */
export const jobRegistry = {
  noop: defineJob({
    payload: z.strictObject({ note: z.string().max(200).optional() }),
    maxAttempts: 3,
    handleIdempotent: async () => {
      // Does nothing, on purpose: the tests and the demo trigger need a kind that always succeeds.
    },
  }),
  [processProviderEventKind]: defineJob({
    payload: ProcessProviderEventPayloadSchema,
    maxAttempts: jobLimits.defaultMaxAttempts,
    prepare: (payload) => prepareProviderEvent(payload),
    handleIdempotent: (context) => handleProviderEvent(context),
  }),
  'guest-confirmation': defineJob({
    payload: BookingEmailPayloadSchema,
    maxAttempts: jobLimits.defaultMaxAttempts,
    handleIdempotent: sendGuestConfirmation,
  }),
  'host-booking-notice': defineJob({
    payload: BookingEmailPayloadSchema,
    maxAttempts: jobLimits.defaultMaxAttempts,
    handleIdempotent: sendHostBookingNotice,
  }),
} satisfies JobRegistry;
