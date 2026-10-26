import 'server-only';
import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import {
  MailboxMessageSchema,
  MailboxSummarySchema,
  maxSendAttempts,
  staleQueuedMinutes,
  statusAfterDeliveryEvent,
  suppressionReasonFor,
  type DeliveryEvent,
  type EmailAdapterName,
  type MailboxMessage,
  type MailboxSummary,
  type MessageStatus,
} from '@/lib/email/message';
import { db } from './client';
import { emailSuppressions, messages } from './schema';

const mailboxPageSize = 100;

export type MessageRecord = {
  id: string;
  status: MessageStatus;
  template: string;
  recipient: string;
  adapter: EmailAdapterName;
  attempts: number;
};

const recordColumns = {
  id: messages.id,
  status: messages.status,
  template: messages.template,
  recipient: messages.recipient,
  adapter: messages.adapter,
  attempts: messages.attempts,
};

export async function findMessageByKey(
  idempotencyKey: string,
): Promise<MessageRecord | null> {
  const [row] = await db
    .select(recordColumns)
    .from(messages)
    .where(eq(messages.idempotencyKey, idempotencyKey));
  return row ?? null;
}

type NewMessage = {
  idempotencyKey: string;
  template: string;
  recipient: string;
  subject: string;
  adapter: EmailAdapterName;
};

/** Null when another caller already holds this key. */
export async function insertMessage(
  message: NewMessage,
  outcome: 'attempt' | 'suppressed',
): Promise<MessageRecord | null> {
  const [row] = await db
    .insert(messages)
    .values(
      outcome === 'attempt'
        ? { ...message, status: 'queued', attempts: 1 }
        : { ...message, status: 'suppressed' },
    )
    .onConflictDoNothing({ target: messages.idempotencyKey })
    .returning(recordColumns);
  return row ?? null;
}

/**
 * Takes a failed message, or one a crashed sender left queued, for one more provider call. Null
 * when another caller has it in flight, or when the attempts are used up.
 */
export async function claimRetry(
  id: string,
  adapter: EmailAdapterName,
): Promise<MessageRecord | null> {
  const [row] = await db
    .update(messages)
    .set({
      status: 'queued',
      attempts: sql`${messages.attempts} + 1`,
      failureReason: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(messages.id, id),
        eq(messages.adapter, adapter),
        lt(messages.attempts, maxSendAttempts),
        or(
          eq(messages.status, 'failed'),
          and(
            eq(messages.status, 'queued'),
            lt(
              messages.updatedAt,
              sql`now() - make_interval(mins => ${staleQueuedMinutes})`,
            ),
          ),
        ),
      ),
    )
    .returning(recordColumns);
  return row ?? null;
}

/** A write that matches no row means the message was not in the state this call assumed, so it throws. */
function expectOneRow(rows: unknown[], what: string): void {
  if (rows.length !== 1) {
    throw new Error(
      `Recording ${what} changed ${String(rows.length)} rows, expected 1`,
    );
  }
}

export async function recordSent(
  id: string,
  sent: {
    status: 'sent' | 'captured';
    providerMessageId: string;
    body?: { html: string; text: string };
  },
): Promise<void> {
  const rows = await db
    .update(messages)
    .set({
      status: sent.status,
      providerMessageId: sent.providerMessageId,
      html: sent.body?.html ?? null,
      textBody: sent.body?.text ?? null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(messages.id, id), eq(messages.status, 'queued')))
    .returning({ id: messages.id });
  expectOneRow(rows, 'a sent message');
}

export async function recordFailed(id: string, reason: string): Promise<void> {
  const rows = await db
    .update(messages)
    .set({ status: 'failed', failureReason: reason, updatedAt: sql`now()` })
    .where(and(eq(messages.id, id), eq(messages.status, 'queued')))
    .returning({ id: messages.id });
  expectOneRow(rows, 'a failed message');
}

/** For a message that was failed or abandoned and whose address has since been suppressed. */
export async function recordSuppressed(id: string): Promise<void> {
  const rows = await db
    .update(messages)
    .set({ status: 'suppressed', failureReason: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(messages.id, id),
        or(eq(messages.status, 'failed'), eq(messages.status, 'queued')),
      ),
    )
    .returning({ id: messages.id });
  expectOneRow(rows, 'a suppressed message');
}

export async function isAddressSuppressed(address: string): Promise<boolean> {
  const [row] = await db
    .select({ address: emailSuppressions.address })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.address, address));
  return row !== undefined;
}

/**
 * Moves a message to the status a provider event implies and suppresses the address after a hard
 * bounce or complaint. An event for a message this app did not send changes nothing.
 */
export async function applyDeliveryEvent(
  adapter: EmailAdapterName,
  event: DeliveryEvent,
): Promise<'applied' | 'unknown'> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: messages.id,
        status: messages.status,
        recipient: messages.recipient,
      })
      .from(messages)
      .where(
        and(
          eq(messages.adapter, adapter),
          eq(messages.providerMessageId, event.providerMessageId),
        ),
      )
      .for('update');
    if (!row) return 'unknown';

    const next = statusAfterDeliveryEvent(row.status, event.kind);
    if (next) {
      await tx
        .update(messages)
        .set({ status: next, updatedAt: sql`now()` })
        .where(eq(messages.id, row.id));
    }
    const reason = suppressionReasonFor(event.kind);
    if (reason) {
      await tx
        .insert(emailSuppressions)
        .values({
          address: row.recipient,
          reason,
          sourceMessageId: row.id,
        })
        .onConflictDoNothing();
    }
    return 'applied';
  });
}

// The two reads below show message bodies, so they are called only from the dev mailbox module,
// which checks the shared secret first. They use the pooled handle, not the HTTP one, because the
// local Postgres in docker-compose cannot answer Neon's HTTP protocol and the mailbox is a local tool.

const mailboxRows = and(eq(messages.adapter, 'fake'), isNotNull(messages.html));

/** Newest first, at most one page. */
export async function listMailboxSummaries(): Promise<MailboxSummary[]> {
  const rows = await db
    .select({
      id: messages.id,
      recipient: messages.recipient,
      template: messages.template,
      subject: messages.subject,
      status: messages.status,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(mailboxRows)
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(mailboxPageSize);
  return MailboxSummarySchema.array().parse(rows);
}

export async function findMailboxMessage(
  id: string,
): Promise<MailboxMessage | null> {
  const [row] = await db
    .select({
      id: messages.id,
      recipient: messages.recipient,
      template: messages.template,
      subject: messages.subject,
      status: messages.status,
      createdAt: messages.createdAt,
      html: messages.html,
      textBody: messages.textBody,
    })
    .from(messages)
    .where(and(eq(messages.id, id), mailboxRows));
  return row ? MailboxMessageSchema.parse(row) : null;
}
