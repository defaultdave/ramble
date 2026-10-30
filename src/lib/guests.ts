import { z } from 'zod';
import { EntityIdSchema, WriteIdSchema } from './catalog';
import {
  EmailAddressSchema,
  maxEmailAddressLength,
  normalizeEmailAddress,
} from './email/address';

// What a guest, a consent, and a privacy request are, and every rule that decides what the data
// layer does with them. The pgEnums and the CHECKs on the three tables are built from these
// tuples and constants, so the database refuses what these schemas refuse.

/** The address an anonymized guest keeps. `.invalid` is reserved (RFC 2606), so it can never receive mail. */
export const anonymizedEmailDomain = 'anonymized.invalid';
export const anonymizedEmailPattern = String.raw`@anonymized\.invalid$`;
const anonymizedEmailPrefix = 'erased-';

/** One address per guest row, derived from the row's own id so two erased guests never collide. */
export function anonymizedEmail(guestId: string): string {
  return `${anonymizedEmailPrefix}${guestId.toLowerCase()}@${anonymizedEmailDomain}`;
}

export function isAnonymizedEmail(email: string): boolean {
  return email.endsWith(`@${anonymizedEmailDomain}`);
}

/**
 * A guest's address as the one spelling it is stored in (case folded), or refused. The reserved
 * erased-guest domain is refused so a real address can never look like a tombstone.
 */
export const GuestEmailSchema = z
  .string()
  .max(maxEmailAddressLength)
  .transform(normalizeEmailAddress)
  .pipe(
    EmailAddressSchema.refine((email) => !isAnonymizedEmail(email), {
      message: 'That domain is reserved',
    }),
  );

export const GuestSchema = z.object({
  id: EntityIdSchema,
  email: EmailAddressSchema,
  createdAt: z.date(),
  anonymizedAt: z.date().nullable(),
});
export type Guest = z.infer<typeof GuestSchema>;

export const consentKinds = ['newsletter', 'attribution'] as const;
export type ConsentKind = (typeof consentKinds)[number];

export const consentStatuses = ['granted', 'withdrawn'] as const;
export type ConsentStatus = (typeof consentStatuses)[number];

export const consentSources = [
  'checkout',
  'unsubscribe',
  'ops',
  'erasure',
] as const;
export type ConsentSource = (typeof consentSources)[number];

/** A checkout can only grant, and an unsubscribe or an erasure can only withdraw. Ops records either. */
export const consentSourceStatuses = {
  checkout: ['granted'],
  unsubscribe: ['withdrawn'],
  ops: ['granted', 'withdrawn'],
  erasure: ['withdrawn'],
} as const satisfies Record<ConsentSource, readonly ConsentStatus[]>;

export function consentSourceAllowsStatus(
  source: ConsentSource,
  status: ConsentStatus,
): boolean {
  return (consentSourceStatuses[source] as readonly ConsentStatus[]).includes(
    status,
  );
}

export const RecordConsentInputSchema = z
  .strictObject({
    guestId: WriteIdSchema,
    kind: z.enum(consentKinds),
    status: z.enum(consentStatuses),
    source: z.enum(consentSources),
  })
  .refine((input) => consentSourceAllowsStatus(input.source, input.status), {
    message: 'That source cannot record that status',
    path: ['source'],
  });

export const ConsentSchema = z.object({
  id: EntityIdSchema,
  guestId: EntityIdSchema,
  kind: z.enum(consentKinds),
  status: z.enum(consentStatuses),
  source: z.enum(consentSources),
  recordedAt: z.date(),
});
export type Consent = z.infer<typeof ConsentSchema>;

/**
 * A consent row is evidence of a change, so a request that repeats the latest status writes
 * nothing: the first grant keeps its own time and source. A first withdrawal with nothing before
 * it is still recorded.
 */
export function consentDecision(
  latest: ConsentStatus | null,
  requested: ConsentStatus,
): 'record' | 'unchanged' {
  return latest === requested ? 'unchanged' : 'record';
}

/** The kinds an erasure must withdraw: those whose latest row is a grant. Each kind once. */
export function consentKindsToWithdraw(
  latest: readonly Pick<Consent, 'kind' | 'status'>[],
): ConsentKind[] {
  const granted = latest
    .filter((consent) => consent.status === 'granted')
    .map((consent) => consent.kind);
  return consentKinds.filter((kind) => granted.includes(kind));
}

type GuestState = Pick<Guest, 'anonymizedAt'>;

/** Rows are written about a guest who exists and has not been erased. Decided under the guest row lock. */
export function guestAcceptsWrites(guest: GuestState | null): boolean {
  return guest !== null && guest.anonymizedAt === null;
}

export function anonymizeDecision<G extends GuestState>(
  guest: G | null,
):
  | { action: 'not_found' }
  | { action: 'already_anonymized' }
  | { action: 'anonymize'; guest: G } {
  if (guest === null) return { action: 'not_found' };
  if (guest.anonymizedAt !== null) return { action: 'already_anonymized' };
  return { action: 'anonymize', guest };
}

export const privacyRequestKinds = ['access', 'deletion'] as const;

export const privacyRequestStatuses = [
  'open',
  'completed',
  'declined',
] as const;

export const RecordPrivacyRequestInputSchema = z.strictObject({
  guestId: WriteIdSchema,
  kind: z.enum(privacyRequestKinds),
});

export const PrivacyRequestSchema = z.object({
  id: EntityIdSchema,
  guestId: EntityIdSchema,
  kind: z.enum(privacyRequestKinds),
  status: z.enum(privacyRequestStatuses),
  createdAt: z.date(),
  resolvedAt: z.date().nullable(),
});
export type PrivacyRequest = z.infer<typeof PrivacyRequestSchema>;

/** A guest has at most one open request of each kind; asking again returns the open one. */
export function privacyRequestDecision(
  open: PrivacyRequest | null,
): { action: 'create' } | { action: 'already_open'; request: PrivacyRequest } {
  return open === null
    ? { action: 'create' }
    : { action: 'already_open', request: open };
}
