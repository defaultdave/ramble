import { randomInt, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createOrderParents } from './orderParents';

type Client = typeof import('@/server/db/client');

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const reference = () =>
  `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;

/** What a ledger row points at: a confirmed booking, its succeeded attempt, a refund, and a transfer. */
export type LedgerParents = Awaited<ReturnType<typeof createLedgerParents>>;

/** Order parents plus helpers that make the rows a ledger entry can point at, with the least a row needs. */
export async function createLedgerParents(db: Client['db'], tag: string) {
  const parents = await createOrderParents(db, tag);
  const created = '2026-11-01T12:00:00Z';

  async function newOrder(): Promise<string> {
    const id = randomUUID();
    const holdId = randomUUID();
    await db.execute(sql`INSERT INTO orders (
      id, reference, kind, status, idempotency_key, hold_id, session_id, experience_id, host_id,
      guest_id, contact_email, lead_guest_name, terms_document_id, ticket_subtotal_minor,
      tax_treatment, tax_rate_ppm, tax_minor, total_minor, amount_due_minor, commission_rate_bps,
      commission_minor, cancellation_tier_id, created_at, confirmed_at
    ) VALUES (
      ${id}, ${reference()}, 'booking', 'confirmed', ${`book:${holdId}`}, ${holdId}, ${randomUUID()},
      ${parents.experienceId}, ${parents.hostId}, ${parents.guestId}, 'pat@example.com', 'Pat Smith',
      ${randomUUID()}, 13000, 'not_taxable', 0, 0, 13000, 13000, 1500, 1950, ${parents.tierId},
      ${created}, ${created}
    )`);
    return id;
  }

  async function newAttempt(orderId: string): Promise<string> {
    const id = randomUUID();
    await db.execute(sql`INSERT INTO payment_attempts (
      id, order_id, attempt_no, provider, provider_key, amount_minor, status, created_at, updated_at
    ) VALUES (
      ${id}, ${orderId}, 1, 'fake', ${`pay:${orderId}:1`}, 13000, 'succeeded', ${created}, ${created}
    )`);
    return id;
  }

  async function newRefund(
    orderId: string,
    attemptId: string,
  ): Promise<string> {
    const id = randomUUID();
    await db.execute(sql`INSERT INTO refunds (
      id, order_id, payment_attempt_id, ticket_minor, tax_minor, commission_returned_minor,
      amount_minor, reason, provider_key, status, created_at
    ) VALUES (
      ${id}, ${orderId}, ${attemptId}, 6500, 0, 975, 6500, 'guest_cancel', ${`refund:${id}`},
      'pending', ${created}
    )`);
    return id;
  }

  async function newTransfer(orderId: string): Promise<string> {
    const id = randomUUID();
    await db.execute(sql`INSERT INTO transfers (
      id, order_id, host_id, release_after, provider_key, status
    ) VALUES (
      ${id}, ${orderId}, ${parents.hostId}, ${created}, ${`transfer:${orderId}`}, 'scheduled'
    )`);
    return id;
  }

  return { ...parents, newOrder, newAttempt, newRefund, newTransfer };
}
