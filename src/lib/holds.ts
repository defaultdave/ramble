import { z } from 'zod';
import { WriteIdSchema, experienceStatuses, priceKinds } from './catalog';
import { MAX_LINES, type PricedOption, type PricingLines } from './pricing';
import { maxAllocation, sessionStatuses } from './sessions';
import { settingsBounds } from './settings';

export const holdPurposes = ['booking', 'gift_redemption'] as const;

export const holdStatuses = [
  'active',
  'paying',
  'converted',
  'released',
] as const;

export const holdReleasedReasons = [
  'expired',
  'guest_left',
  'payment_abandoned',
  'sold_out_after_lapse',
  'session_cancelled',
  'superseded',
] as const;

type HoldStatus = (typeof holdStatuses)[number];

export const holdLimits = {
  minSeats: 1,
  /** The largest party one hold takes: the space-using total, and each line's quantity (design doc 4.2.3). */
  maxSeats: 6,
  maxItems: MAX_LINES,
  giftTokenChars: 256,
  maxHoldMinutes: settingsBounds.holdMinutes.max,
  /** `sold_out` offers at most this many other dates, within this many days, from this many candidates. */
  alternatives: 3,
  alternativeDays: 14,
  alternativeCandidates: 20,
} as const;

/** sha-256 in hex, the shape `rate_limits` keys already use. The database CHECKs on `holds` spell the same pattern. */
export const deviceHashPattern = String.raw`^[0-9a-f]{64}$`;

const millisecondsPerMinute = 60_000;
const millisecondsPerDay = 86_400_000;

const ItemInputSchema = z.object({
  priceOptionId: WriteIdSchema,
  quantity: z.int().min(1).max(holdLimits.maxSeats),
});

/**
 * The guest's request. A failed parse becomes `invalid` (see `invalidFromIssues`), never a throw.
 * Ids are lower-cased here so they compare equal to what Postgres returns.
 */
export const ReserveInputSchema = z
  .object({
    sessionId: WriteIdSchema,
    items: z.array(ItemInputSchema).min(1).max(holdLimits.maxItems),
    purpose: z.enum(holdPurposes),
    giftToken: z.string().min(1).max(holdLimits.giftTokenChars).optional(),
  })
  .superRefine((input, context) => {
    if (
      new Set(input.items.map((item) => item.priceOptionId)).size !==
      input.items.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'invalid',
      });
    }
    const wantsGift = input.purpose === 'gift_redemption';
    if (wantsGift !== (input.giftToken !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['giftToken'],
        message: wantsGift ? 'required' : 'invalid',
      });
    }
  });
export type ReserveSpacesInput = z.input<typeof ReserveInputSchema>;

export const ReleaseInputSchema = z.object({ holdId: WriteIdSchema });
export type ReleaseHoldInput = z.input<typeof ReleaseInputSchema>;

const HeldLineSchema = z.object({
  priceOptionId: z.string(),
  kind: z.enum(priceKinds),
  quantity: z.int(),
  unitPriceMinor: z.int(),
  usesSpace: z.boolean(),
  lineTotalMinor: z.int(),
});

const SessionSummarySchema = z.object({
  sessionId: z.string(),
  startsAt: z.iso.datetime(),
  timeZone: z.string(),
  spacesLeft: z.int().min(1),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/** Field errors are stable codes; the copy is the booking sheet's (design doc 4.3). */
const fieldErrorCodes = [
  'invalid',
  'required',
  'not_offered',
  'party_size',
] as const;

export const ReserveResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('held'),
    holdId: z.string(),
    expiresAt: z.iso.datetime(),
    totalMinor: z.int().min(0),
    lines: z.array(HeldLineSchema).min(1).max(holdLimits.maxItems),
  }),
  z.object({
    status: z.literal('sold_out'),
    alternatives: z.array(SessionSummarySchema).max(holdLimits.alternatives),
  }),
  z.object({
    status: z.literal('blocked'),
    reason: z.enum(['device_limit', 'too_many_holds']),
    until: z.iso.datetime().optional(),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum([
      'session_cancelled',
      'bookings_paused',
      'past',
      'gift_not_valid',
    ]),
  }),
  z.object({
    status: z.literal('invalid'),
    fieldErrors: z.record(z.string(), z.enum(fieldErrorCodes)),
  }),
]);
export type ReserveResult = z.infer<typeof ReserveResultSchema>;
type FieldErrors = Extract<ReserveResult, { status: 'invalid' }>['fieldErrors'];

export type ReleaseResult = {
  status: 'released' | 'payment_in_progress' | 'not_found';
};

type Issue = { path: readonly PropertyKey[]; message: string };

/**
 * One stable code per field from a failed parse: the field's first issue, `required` when a rule
 * said so, `invalid` for everything else. The parse's own messages never reach the guest.
 */
export function invalidFromIssues(issues: readonly Issue[]): ReserveResult {
  const fieldErrors: FieldErrors = {};
  for (const issue of issues) {
    const field = typeof issue.path[0] === 'string' ? issue.path[0] : 'input';
    fieldErrors[field] ??=
      issue.message === 'required' ? 'required' : 'invalid';
  }
  return { status: 'invalid', fieldErrors };
}

export type HoldTimes = {
  status: HoldStatus;
  expiresAt: Date;
  payingUntil: Date | null;
};

/**
 * The one predicate for an open hold (design doc 4.2.3): `active` before `expires_at`, or `paying`
 * before `paying_until`. A deadline equal to `at` is no longer open. Spaces left, the device limit,
 * and the block all use it.
 */
export function isOpenHold(hold: HoldTimes, at: Date): boolean {
  switch (hold.status) {
    case 'active':
      return hold.expiresAt.getTime() > at.getTime();
    case 'paying':
      return (
        hold.payingUntil !== null && hold.payingUntil.getTime() > at.getTime()
      );
    case 'converted':
    case 'released':
      return false;
  }
}

/** The seats the open holds among `holds` take. A lapsed or finished hold takes none. */
export function openHeldSeats(
  holds: readonly (HoldTimes & { seats: number })[],
  at: Date,
): number {
  return holds.reduce(
    (total, hold) => (isOpenHold(hold, at) ? total + hold.seats : total),
    0,
  );
}

/**
 * Spaces left at `at` (design doc 4.2.2), returned as is: zero or less reads as sold out, and a
 * lowered capacity can leave it negative.
 */
export function spacesLeft(
  session: { allocation: number; seatsSold: number },
  holds: readonly (HoldTimes & { seats: number })[],
  at: Date,
): number {
  return session.allocation - session.seatsSold - openHeldSeats(holds, at);
}

/**
 * The open holds of one session can number at most its capacity, because each takes a space. A
 * fetch limited to one more than that proves the table is not lying: more rows than the largest
 * capacity throws instead of being summed.
 */
export function requireBoundedHolds<T>(
  rows: readonly T[],
  sessionCount = 1,
): readonly T[] {
  if (rows.length > maxAllocation * sessionCount) {
    throw new RangeError(
      `Sessions have more open holds than their largest capacity (${String(maxAllocation)} each)`,
    );
  }
  return rows;
}

/** A party fits when its space-using seats are at most the spaces left. */
export function partyFits(seats: number, spacesLeftNow: number): boolean {
  return seats <= spacesLeftNow;
}

export type PartyCheck =
  | { ok: true; seats: number }
  | { ok: false; fieldErrors: { items: 'not_offered' | 'party_size' } };

/**
 * The space-using seats of a party, or why it cannot be priced: a price option the experience does
 * not offer, or a space-using total outside 1 to 6. It runs before pricing, so pricing's own
 * RangeError stays a programming error.
 */
export function partyFor(
  items: readonly { priceOptionId: string; quantity: number }[],
  options: readonly Pick<PricedOption, 'id' | 'usesSpace'>[],
): PartyCheck {
  let seats = 0;
  for (const item of items) {
    const option = options.find(({ id }) => id === item.priceOptionId);
    if (!option) return { ok: false, fieldErrors: { items: 'not_offered' } };
    if (option.usesSpace) seats += item.quantity;
  }
  return seats < holdLimits.minSeats || seats > holdLimits.maxSeats
    ? { ok: false, fieldErrors: { items: 'party_size' } }
    : { ok: true, seats };
}

/**
 * When a hold placed at `at` lapses. A length outside the settings bounds throws, so a broken
 * setting fails the request instead of writing a hold the database CHECK would refuse.
 */
export function holdExpiresAt(at: Date, holdMinutes: number): Date {
  if (
    !Number.isInteger(holdMinutes) ||
    holdMinutes < settingsBounds.holdMinutes.min ||
    holdMinutes > settingsBounds.holdMinutes.max
  ) {
    throw new RangeError('The hold length is outside the settings bounds');
  }
  return new Date(at.getTime() + holdMinutes * millisecondsPerMinute);
}

/** Bookings paused by ops (PRD-16 switch): nothing is held, and nothing is written. */
export function pausedRefusal(bookingsPaused: boolean): ReserveResult | null {
  return bookingsPaused
    ? { status: 'unavailable', reason: 'bookings_paused' }
    : null;
}

/**
 * A gift redemption is refused until the gift branch exists, so the closed stub fails closed and
 * U-064a changes no schema.
 * TODO(U-064a): the gift branch: lock the gift, check it is delivered and before `valid_until`.
 */
export function giftRefusal(
  purpose: (typeof holdPurposes)[number],
): ReserveResult | null {
  return purpose === 'gift_redemption'
    ? { status: 'unavailable', reason: 'gift_not_valid' }
    : null;
}

/** One answer for a session that does not exist and one a guest may not book. */
export const unbookableSession: ReserveResult = {
  status: 'invalid',
  fieldErrors: { sessionId: 'invalid' },
};

export type ReserveSubject = {
  experienceStatus: (typeof experienceStatuses)[number];
  sessionStatus: (typeof sessionStatuses)[number];
  startsAt: Date;
};

/**
 * Whether a session takes a hold at `at`. A missing session and one whose experience a guest may
 * not book answer alike (`invalid` on `sessionId`), so a draft cannot be told from nothing. Only a
 * `scheduled` session takes holds (design doc 4.2.2), and one that has started does not.
 */
export function reserveRefusal(
  subject: ReserveSubject | null | undefined,
  at: Date,
): ReserveResult | null {
  if (subject?.experienceStatus !== 'live') return unbookableSession;
  if (subject.sessionStatus !== 'scheduled') {
    return { status: 'unavailable', reason: 'session_cancelled' };
  }
  if (subject.startsAt.getTime() <= at.getTime()) {
    return { status: 'unavailable', reason: 'past' };
  }
  return null;
}

export function heldResult(
  hold: { id: string; expiresAt: Date },
  priced: Pick<PricingLines, 'totalMinor' | 'lines'>,
): ReserveResult {
  return {
    status: 'held',
    holdId: hold.id,
    expiresAt: hold.expiresAt.toISOString(),
    totalMinor: priced.totalMinor,
    lines: priced.lines,
  };
}

/** The reserve was not placed because the request came from a bot. It reads as the hold block, with no end time. */
export function blockedForBot(): ReserveResult {
  return { status: 'blocked', reason: 'too_many_holds' };
}

/** The reserve was not placed because the device used up its tries; `until` is when the window frees one. */
export function blockedForRateLimit(
  retryAfterSeconds: number,
  at: Date,
): ReserveResult {
  return {
    status: 'blocked',
    reason: 'too_many_holds',
    until: new Date(at.getTime() + retryAfterSeconds * 1000).toISOString(),
  };
}

type ReleaseSubject = {
  status: HoldStatus;
  deviceKey: string;
  sessionId: string;
};

export type ReleaseDecision =
  { release: true } | { release: false; result: ReleaseResult };

/**
 * What `releaseHold` does with the hold it found under the locks. A missing hold, another device's
 * hold, one that moved to another session since it was read, and a converted hold all answer
 * `not_found`, so a stale tab or a stranger with a hold id learns nothing about a booking. A
 * `paying` hold is refused (design doc 4.2.3), a released one answers `released` again, and an
 * `active` one, open or lapsed, is released. The device keys are sha-256 hashes, so comparing them
 * with `===` reveals nothing a guesser could use.
 */
export function decideRelease(
  hold: ReleaseSubject | null,
  caller: { deviceKey: string; sessionId: string },
): ReleaseDecision {
  if (
    hold === null ||
    hold.deviceKey !== caller.deviceKey ||
    hold.sessionId !== caller.sessionId
  ) {
    return { release: false, result: { status: 'not_found' } };
  }
  switch (hold.status) {
    case 'active':
      return { release: true };
    case 'paying':
      return { release: false, result: { status: 'payment_in_progress' } };
    case 'released':
      return { release: false, result: { status: 'released' } };
    case 'converted':
      return { release: false, result: { status: 'not_found' } };
  }
}

/** The span other dates are offered in after `sold_out`: after `at`, up to the window's end. */
export function alternativeWindow(at: Date): { from: Date; until: Date } {
  return {
    from: at,
    until: new Date(
      at.getTime() + holdLimits.alternativeDays * millisecondsPerDay,
    ),
  };
}

type Candidate = {
  id: string;
  startsAt: Date;
  timeZone: string;
  allocation: number;
  seatsSold: number;
  status: (typeof sessionStatuses)[number];
};

/**
 * Up to three other dates for a party that did not fit: scheduled, starting after `at` and within
 * the window, with room for the whole party, soonest first. The query pre-filters; this decides.
 */
export function pickAlternatives(
  candidates: readonly Candidate[],
  holds: readonly (HoldTimes & { seats: number; sessionId: string })[],
  seats: number,
  at: Date,
): SessionSummary[] {
  const window = alternativeWindow(at);
  const summaries: SessionSummary[] = [];
  const ordered = candidates.toSorted(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  for (const candidate of ordered) {
    if (summaries.length === holdLimits.alternatives) break;
    const starts = candidate.startsAt.getTime();
    if (
      candidate.status !== 'scheduled' ||
      starts <= window.from.getTime() ||
      starts > window.until.getTime()
    ) {
      continue;
    }
    const left = spacesLeft(
      candidate,
      holds.filter((hold) => hold.sessionId === candidate.id),
      at,
    );
    if (left >= seats) {
      summaries.push({
        sessionId: candidate.id,
        startsAt: candidate.startsAt.toISOString(),
        timeZone: candidate.timeZone,
        spacesLeft: left,
      });
    }
  }
  return summaries;
}
