import { z } from 'zod';
import type { BotCheckResult } from './botCheck';
import { WriteIdSchema, experienceStatuses, priceKinds } from './catalog';
import { MAX_LINES, type PricedOption, type PricingLines } from './pricing';
import { maxAllocation, sessionStatuses } from './sessions';
import { jobLimits } from './jobs';
import { sha256HexDigits, type RateLimitDecision } from './rateLimits';
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
type ReleasedReason = (typeof holdReleasedReasons)[number];

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
  /** Seats across the open holds of one device, or one address, plus the new hold (PRD-17). */
  deviceSeatLimit: 6,
  /** This many lapsed holds inside the window block new holds (PRD-17). */
  blockLapses: 3,
  blockMinutes: 15,
  /** Most lapsed-hold rows one reserve reads for the block; more than this is a table that is wrong. */
  blockScan: 100,
  /** Rows one cleanup batch releases or scrubs, and how long a released hold keeps its hashes. */
  cleanupBatch: 100,
  cleanupMaxBatches: 20,
  releasedRetentionDays: 30,
} as const;

/** Stands in for the device and address hashes of a hold whose retention ended. It is a valid hash, and no cookie produces it. */
export const scrubbedHash = '0'.repeat(64);

/** sha-256 in hex, the shape `rate_limits` keys already use. The database CHECKs on `holds` spell the same pattern. */
export const deviceHashPattern = `^${sha256HexDigits}$`;

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
    // Zod runs this after `.max()` fails too, so the length comes first.
    if (
      input.items.length <= holdLimits.maxItems &&
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

export type ReleaseResult = {
  status: 'released' | 'payment_in_progress' | 'not_found';
};

type Issue = { path: readonly PropertyKey[]; message: string };

/**
 * One stable code per field from a failed parse: the field's first issue, `required` when a rule
 * said so, `invalid` for everything else. The parse's own messages never reach the guest. `fieldOf`
 * names the field an issue is reported on, so a form with nested fields can key by the whole path.
 */
export function fieldErrorsFromIssues(
  issues: readonly Issue[],
  fieldOf: (path: readonly PropertyKey[]) => string,
): Record<string, 'required' | 'invalid'> {
  const fieldErrors: Record<string, 'required' | 'invalid'> = {};
  for (const issue of issues) {
    fieldErrors[fieldOf(issue.path)] ??=
      issue.message === 'required' ? 'required' : 'invalid';
  }
  return fieldErrors;
}

const firstField = (path: readonly PropertyKey[]) =>
  typeof path[0] === 'string' ? path[0] : 'input';

/** A failed parse of the reserve input, one code per top-level field. */
export function invalidFromIssues(issues: readonly Issue[]): ReserveResult {
  return {
    status: 'invalid',
    fieldErrors: fieldErrorsFromIssues(issues, firstField),
  };
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
 * Spaces left once `openSeats` are held (design doc 4.2.2), returned as is: zero or less reads as
 * sold out, and a lowered capacity can leave it negative.
 */
export function remainingSpaces(
  session: { allocation: number; seatsSold: number },
  openSeats: number,
): number {
  return session.allocation - session.seatsSold - openSeats;
}

/** Spaces left at `at`, from the open holds among `holds`. */
export function spacesLeft(
  session: { allocation: number; seatsSold: number },
  holds: readonly (HoldTimes & { seats: number })[],
  at: Date,
): number {
  return remainingSpaces(session, openHeldSeats(holds, at));
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

/**
 * When a hold that starts to pay at `at` stops counting: `greatest(expires_at, now()) + grace`
 * (design doc 4.2.3), so a guest who pays at the last second still has the grace, and the deadline
 * never falls before `expires_at`. A grace outside the settings bounds throws, like the hold length.
 */
export function payingUntil(
  expiresAt: Date,
  at: Date,
  graceMinutes: number,
): Date {
  if (
    !Number.isInteger(graceMinutes) ||
    graceMinutes < settingsBounds.paymentGraceMinutes.min ||
    graceMinutes > settingsBounds.paymentGraceMinutes.max
  ) {
    throw new RangeError('The payment grace is outside the settings bounds');
  }
  return new Date(
    Math.max(expiresAt.getTime(), at.getTime()) +
      graceMinutes * millisecondsPerMinute,
  );
}

/**
 * The write that makes a hold `paying`, or null when there is nothing to write: a hold that is not
 * open at `at` is never revived, and one already `paying` keeps its deadline (it is extended only
 * by the provider's `requires_action`). An `active` hold that is open moves to `paying`.
 */
export function payingHold(
  hold: HoldTimes,
  at: Date,
  graceMinutes: number,
): { payingUntil: Date } | null {
  if (hold.status !== 'active' || !isOpenHold(hold, at)) return null;
  return { payingUntil: payingUntil(hold.expiresAt, at, graceMinutes) };
}

/** Bookings paused by ops (PRD-16 switch): nothing is held, and nothing is written. */
export function pausedRefusal(bookingsPaused: boolean): ReserveResult | null {
  return bookingsPaused
    ? { status: 'unavailable', reason: 'bookings_paused' }
    : null;
}

/**
 * A gift redemption is refused until the gift branch exists, so the closed stub fails closed and
 * the gift branch changes no schema.
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

/** Whether a reserve spends one of the device's tries: a bot is refused first and spends none. */
export function spendsReserveTry(verdict: BotCheckResult): boolean {
  return verdict !== 'bot';
}

/**
 * Why a reserve is refused before it reaches the data layer, or `null` to let it through: a bot is
 * blocked with no end time, a device over its limit until the window frees a try. `tried` is `null`
 * when no try was spent, which `spendsReserveTry` says only for a bot. `at` is the database clock.
 */
export function reserveBlock(
  verdict: BotCheckResult,
  tried: RateLimitDecision | null,
  at: Date,
): ReserveResult | null {
  if (verdict === 'bot') return blockedForBot();
  return tried === null || tried.allowed
    ? null
    : blockedForRateLimit(tried.retryAfterSeconds, at);
}

/**
 * Whether a hold is the calling device's. A guest's device-keyed rows (a hold, and what is made
 * under it) carry the sha-256 of the device cookie, so a plain comparison reveals nothing a
 * guesser could use. A missing hold is nobody's.
 */
export function isHoldOfDevice<T extends { deviceKey: string }>(
  hold: T | null | undefined,
  deviceKey: string,
): hold is T {
  return hold !== null && hold !== undefined && hold.deviceKey === deviceKey;
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

/**
 * Fails closed when a read that should be small is not: more rows than `max` means the table
 * disagrees with the rule that bounds it, so the reserve throws instead of deciding on a part.
 */
export function requireAtMost<T>(
  rows: readonly T[],
  max: number,
  what: string,
): readonly T[] {
  if (rows.length > max) {
    throw new RangeError(`More ${what} than the rules allow (${String(max)})`);
  }
  return rows;
}

/**
 * The device's own open `active` holds on the session a new hold is placed on. Each is released as
 * `superseded` in the new hold's transaction (design doc 4.2.3). A `paying` hold is never
 * superseded, because a payment is in flight, and another device's hold never is. Read after the
 * session row is locked, so a hold that moved to `paying` or was released in the meantime is
 * judged as it now stands.
 */
export function holdsToSupersede(
  holds: readonly (HoldTimes & { id: string; deviceKey: string })[],
  deviceKey: string,
  at: Date,
): string[] {
  return holds
    .filter(
      (hold) =>
        isHoldOfDevice(hold, deviceKey) &&
        hold.status === 'active' &&
        isOpenHold(hold, at),
    )
    .map((hold) => hold.id);
}

/** The holds that still count once the ones being superseded leave. */
export function exceptSuperseded<T extends { id: string }>(
  holds: readonly T[],
  superseded: readonly string[],
): T[] {
  return holds.filter((hold) => !superseded.includes(hold.id));
}

/**
 * Refuses a party when the seats in the device's (or address's) other open holds, plus the party,
 * pass the limit (PRD-17). The answer is the same whichever key matched, so a refusal does not say
 * which one did.
 */
export function seatLimitRefusal(
  otherHolds: readonly (HoldTimes & { seats: number })[],
  partySeats: number,
  at: Date,
): ReserveResult | null {
  return openHeldSeats(otherHolds, at) + partySeats > holdLimits.deviceSeatLimit
    ? { status: 'blocked', reason: 'device_limit' }
    : null;
}

/** A lapse older than this no longer counts toward the block; the query pre-filters on it and `blockRefusal` decides. */
export function blockWindowStart(at: Date): Date {
  return new Date(
    at.getTime() - holdLimits.blockMinutes * millisecondsPerMinute,
  );
}

export type LapseCandidate = HoldTimes & {
  releasedReason: ReleasedReason | null;
  updatedAt: Date;
};

/**
 * When a hold stopped counting without becoming a booking, or null when it did not lapse. An
 * `active` hold lapses at `expires_at`, a `paying` one at `paying_until`. Once the cleanup job or
 * the guest has released it, the reason says what it was: `expired` and `payment_abandoned` are
 * lapses, and `guest_left` is one only when it came after the deadline (releasing a hold that
 * already lapsed must not clear the block). `superseded`, `session_cancelled`, and
 * `sold_out_after_lapse` are not the device's lapse, and a converted hold is a booking.
 */
function lapsedDeadline(hold: LapseCandidate): Date | null {
  switch (hold.status) {
    case 'active':
      return hold.expiresAt;
    case 'paying':
      return hold.payingUntil;
    case 'converted':
      return null;
    case 'released':
      switch (hold.releasedReason) {
        case 'expired':
          return hold.expiresAt;
        case 'payment_abandoned':
          return hold.payingUntil ?? hold.expiresAt;
        case 'guest_left':
          return hold.updatedAt.getTime() >= hold.expiresAt.getTime()
            ? hold.expiresAt
            : null;
        case 'sold_out_after_lapse':
        case 'session_cancelled':
        case 'superseded':
        case null:
          return null;
      }
  }
}

/**
 * Blocks new holds while three holds of the device (or address) lapsed inside the last 15 minutes
 * (design doc 4.2.3 Limits). Counted from the deadlines, never from when the cleanup job ran, so a
 * slow job neither hides nor invents a lapse. The block ends when the third most recent deadline
 * leaves the window, so a retry at `until` finds two and goes through.
 */
export function blockRefusal(
  holds: readonly LapseCandidate[],
  at: Date,
): ReserveResult | null {
  const blockMs = holdLimits.blockMinutes * millisecondsPerMinute;
  const windowStart = blockWindowStart(at);
  const deadlines = holds
    .map(lapsedDeadline)
    .filter(
      (deadline): deadline is Date =>
        deadline !== null &&
        deadline.getTime() <= at.getTime() &&
        deadline.getTime() > windowStart.getTime(),
    )
    .toSorted((a, b) => b.getTime() - a.getTime());
  const third = deadlines[holdLimits.blockLapses - 1];
  if (!third) return null;
  return {
    status: 'blocked',
    reason: 'too_many_holds',
    until: new Date(third.getTime() + blockMs).toISOString(),
  };
}

/** What the cleanup job releases a hold as at `at`, or null when the hold is open or finished. */
function cleanupReason(
  hold: HoldTimes,
  at: Date,
): 'expired' | 'payment_abandoned' | null {
  if (isOpenHold(hold, at)) return null;
  switch (hold.status) {
    case 'active':
      return 'expired';
    case 'paying':
      return 'payment_abandoned';
    case 'converted':
    case 'released':
      return null;
  }
}

/**
 * The ids the cleanup job releases at `at`, split by the reason each is released with: a lapsed
 * `active` hold as `expired`, a `paying` hold past `paying_until` as `payment_abandoned`. A hold
 * that is open, converted, or already released is in neither list.
 */
export function holdsToRelease(
  holds: readonly (HoldTimes & { id: string })[],
  at: Date,
): { expired: string[]; payment_abandoned: string[] } {
  const release: { expired: string[]; payment_abandoned: string[] } = {
    expired: [],
    payment_abandoned: [],
  };
  for (const hold of holds) {
    const reason = cleanupReason(hold, at);
    if (reason) release[reason].push(hold.id);
  }
  return release;
}

/**
 * Whether the pulse runs another cleanup batch: the last one was full (so more may wait), and the
 * call is inside its batch and time caps. A short batch means nothing lapsed is left.
 */
export function cleanupMayContinue(input: {
  done: number;
  batches: number;
  elapsedMs: number;
}): boolean {
  return (
    input.done >= holdLimits.cleanupBatch &&
    input.batches < holdLimits.cleanupMaxBatches &&
    input.elapsedMs < jobLimits.drainMaxMillis
  );
}

/** Released holds last updated before this keep no device or address hash (the PII inventory's deletion path). */
export function scrubCutoff(at: Date): Date {
  return new Date(
    at.getTime() - holdLimits.releasedRetentionDays * millisecondsPerDay,
  );
}
