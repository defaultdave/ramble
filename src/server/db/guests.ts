import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import {
  ConsentSchema,
  GuestEmailSchema,
  GuestSchema,
  PrivacyRequestSchema,
  RecordConsentInputSchema,
  RecordPrivacyRequestInputSchema,
  consentDecision,
  guestAcceptsWrites,
  privacyRequestDecision,
  type Consent,
  type Guest,
  type PrivacyRequest,
} from '@/lib/guests';
import type { Caller } from '@/server/auth/caller';
import { db, type Transaction } from './client';
import { consents, guests, privacyRequests } from './schema';
import { requireStaff } from './staff';

/**
 * Locks the guest row until the transaction ends, so a consent, a request, and an anonymization
 * for one guest take turns and each reads what the one before committed. Null when there is none.
 */
export async function lockGuestRow(
  tx: Transaction,
  guestId: string,
): Promise<Guest | null> {
  const [row] = await tx
    .select()
    .from(guests)
    .where(eq(guests.id, guestId))
    .for('update');
  return row ? GuestSchema.parse(row) : null;
}

export type FindOrCreateGuestResult =
  { status: 'ok'; guest: Guest } | { status: 'invalid_email' };

// TODO(U-047a): first caller, inside startPayment's transaction after its device check.
/**
 * The guest with this email, created if there is none. Joins the checkout's open transaction, so
 * the guest, the order, and the consents commit together. One statement takes the row's lock and
 * returns the row, so concurrent calls for one address all get the same guest, and a call that
 * meets an anonymization in flight waits for it and then creates a new guest for the freed address.
 */
export async function findOrCreateGuest(
  tx: Transaction,
  email: string,
): Promise<FindOrCreateGuestResult> {
  const parsed = GuestEmailSchema.safeParse(email);
  if (!parsed.success) return { status: 'invalid_email' };
  const [row] = await tx
    .insert(guests)
    .values({ email: parsed.data })
    .onConflictDoUpdate({
      target: guests.email,
      set: { email: parsed.data },
    })
    .returning();
  if (!row) throw new Error('Guest upsert returned no row');
  return { status: 'ok', guest: GuestSchema.parse(row) };
}

export type RecordConsentResult =
  | { status: 'recorded'; consent: Consent }
  | { status: 'unchanged' }
  | { status: 'invalid' }
  | { status: 'guest_unavailable' };

// TODO(U-047a): first caller, inside startPayment's transaction after its device check.
/**
 * Appends a consent change for a guest. A change to the status the guest already has writes
 * nothing, so the first grant keeps its time and source. The guest row lock makes the latest-row
 * read and the insert one step, and refuses a guest who was erased in the meantime.
 */
export async function recordConsent(
  tx: Transaction,
  input: unknown,
): Promise<RecordConsentResult> {
  const parsed = RecordConsentInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'invalid' };
  const { guestId, kind, status, source } = parsed.data;

  if (!guestAcceptsWrites(await lockGuestRow(tx, guestId))) {
    return { status: 'guest_unavailable' };
  }
  const [latest] = await tx
    .select({ status: consents.status })
    .from(consents)
    .where(and(eq(consents.guestId, guestId), eq(consents.kind, kind)))
    .orderBy(desc(consents.recordedAt), desc(consents.id))
    .limit(1);
  if (consentDecision(latest?.status ?? null, status) === 'unchanged') {
    return { status: 'unchanged' };
  }
  const [row] = await tx
    .insert(consents)
    .values({ guestId, kind, status, source })
    .returning();
  if (!row) throw new Error('Consent insert returned no row');
  return { status: 'recorded', consent: ConsentSchema.parse(row) };
}

export type RecordPrivacyRequestResult =
  | { status: 'recorded'; request: PrivacyRequest }
  | { status: 'already_open'; request: PrivacyRequest }
  | { status: 'invalid' }
  | { status: 'guest_unavailable' };

// TODO(U-085): first caller.
/**
 * Records a guest's request for access or deletion on ops' behalf. A guest has one open request
 * of each kind: asking again returns the open one. The guest row lock makes that check and the
 * insert one step.
 */
export async function recordPrivacyRequest(
  caller: Caller,
  input: unknown,
): Promise<RecordPrivacyRequestResult> {
  requireStaff(caller);
  const parsed = RecordPrivacyRequestInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'invalid' };
  const { guestId, kind } = parsed.data;

  return db.transaction(async (tx) => {
    if (!guestAcceptsWrites(await lockGuestRow(tx, guestId))) {
      return { status: 'guest_unavailable' };
    }
    const [open] = await tx
      .select()
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.guestId, guestId),
          eq(privacyRequests.kind, kind),
          eq(privacyRequests.status, 'open'),
        ),
      )
      .limit(1);
    const decision = privacyRequestDecision(
      open ? PrivacyRequestSchema.parse(open) : null,
    );
    if (decision.action === 'already_open') {
      return { status: 'already_open', request: decision.request };
    }
    const [row] = await tx
      .insert(privacyRequests)
      .values({ guestId, kind })
      .returning();
    if (!row) throw new Error('Privacy request insert returned no row');
    return { status: 'recorded', request: PrivacyRequestSchema.parse(row) };
  });
}
