import 'server-only';
import { desc, eq, sql } from 'drizzle-orm';
import { WriteIdSchema } from '@/lib/catalog';
import {
  anonymizeDecision,
  anonymizedEmail,
  consentKindsToWithdraw,
} from '@/lib/guests';
import type { Caller } from '@/server/auth/caller';
import { db, type Transaction } from './client';
import { lockGuestRow } from './guests';
import { consents, guests } from './schema';
import { requireStaff } from './staff';

/**
 * What a step is told about the person. `email` is the address the guest had before this call, for
 * the tables that hold an address and no guest id (a gift's recipient, the message log).
 */
export type AnonymizeSubject = { guestId: string; email: string };

/**
 * Each table with personal data adds one step to `anonymizeSteps` when it ships, and a row to the
 * PII inventory in src/lib/privacy.ts. A step runs inside the anonymization's transaction, after
 * the guest row is locked and before it is rewritten, so a step that throws leaves nothing changed.
 */
type AnonymizeStep = (
  tx: Transaction,
  subject: AnonymizeSubject,
) => Promise<void>;

/** An erased guest has no live consent: every kind still granted is withdrawn, with source erasure. */
const withdrawGrantedConsents: AnonymizeStep = async (tx, { guestId }) => {
  const latest = await tx
    .selectDistinctOn([consents.kind], {
      kind: consents.kind,
      status: consents.status,
    })
    .from(consents)
    .where(eq(consents.guestId, guestId))
    .orderBy(consents.kind, desc(consents.recordedAt), desc(consents.id));
  const kinds = consentKindsToWithdraw(latest);
  if (kinds.length === 0) return;
  await tx.insert(consents).values(
    kinds.map((kind) => ({
      guestId,
      kind,
      status: 'withdrawn' as const,
      source: 'erasure' as const,
    })),
  );
};

const anonymizeSteps: readonly AnonymizeStep[] = [withdrawGrantedConsents];

export type AnonymizeGuestResult = {
  status: 'anonymized' | 'already_anonymized' | 'not_found';
};

// TODO(U-085): first caller.
/**
 * The one entry point for erasing a person. Runs every step, then rewrites the guest's address to
 * the one derived from its id and stamps the time, all in one transaction under the guest row
 * lock. Running it again changes nothing, and concurrent calls erase once.
 */
export async function anonymizeGuest(
  caller: Caller,
  guestId: string,
): Promise<AnonymizeGuestResult> {
  requireStaff(caller);
  const id = WriteIdSchema.safeParse(guestId);
  if (!id.success) return { status: 'not_found' };

  return db.transaction(async (tx) => {
    const decision = anonymizeDecision(await lockGuestRow(tx, id.data));
    if (decision.action !== 'anonymize') return { status: decision.action };
    const { guest } = decision;

    for (const step of anonymizeSteps) {
      await step(tx, { guestId: guest.id, email: guest.email });
    }
    await tx
      .update(guests)
      .set({
        email: anonymizedEmail(guest.id),
        anonymizedAt: sql`clock_timestamp()`,
      })
      .where(eq(guests.id, guest.id));
    return { status: 'anonymized' };
  });
}
