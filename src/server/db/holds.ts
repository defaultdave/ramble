import 'server-only';
import { and, asc, eq, gt, inArray, lte, ne, or, sql } from 'drizzle-orm';
import {
  ReleaseInputSchema,
  ReserveInputSchema,
  ReserveResultSchema,
  alternativeWindow,
  decideRelease,
  giftRefusal,
  heldResult,
  holdExpiresAt,
  holdLimits,
  invalidFromIssues,
  openHeldSeats,
  partyFits,
  partyFor,
  pausedRefusal,
  pickAlternatives,
  requireBoundedHolds,
  reserveRefusal,
  spacesLeft,
  type ReleaseHoldInput,
  type ReleaseResult,
  type ReserveResult,
  type ReserveSpacesInput,
  type SessionSummary,
  unbookableSession,
} from '@/lib/holds';
import { MAX_LINES, lines as pricingLines, taxRatePpm } from '@/lib/pricing';
import { maxAllocation } from '@/lib/sessions';
import type { Device } from '@/server/device';
import { db } from './client';
import {
  lockDevice,
  lockHoldRow,
  lockSessionRow,
  type Transaction,
} from './locks';
import { holdItems, holds, priceOptions, sessions } from './schema';
import { readHoldSettings } from './settings';
import { readDatabaseTime } from './time';

/**
 * The SQL pre-filter for an open hold (design doc 4.2.3). Deadlines are compared at millisecond
 * precision, as the Date the driver returns is, so this and `isOpenHold` agree on every row; the
 * lib still decides over the rows. A `WHERE` is not a decision, but the two stay in step by test.
 */
function isOpenAt(at: Date) {
  return or(
    and(
      eq(holds.status, 'active'),
      sql`date_trunc('milliseconds', ${holds.expiresAt}) > ${at}`,
    ),
    and(
      eq(holds.status, 'paying'),
      sql`date_trunc('milliseconds', ${holds.payingUntil}) > ${at}`,
    ),
  );
}

const openHoldColumns = {
  sessionId: holds.sessionId,
  seats: holds.seats,
  status: holds.status,
  expiresAt: holds.expiresAt,
  payingUntil: holds.payingUntil,
};

/**
 * The open holds of one session. Each takes at least one space and all fit inside the capacity, so
 * one row more than the largest capacity proves the table is wrong, and `requireBoundedHolds` throws.
 */
async function readOpenHolds(tx: Transaction, sessionId: string, at: Date) {
  const rows = await tx
    .select(openHoldColumns)
    .from(holds)
    .where(and(eq(holds.sessionId, sessionId), isOpenAt(at)))
    .limit(maxAllocation + 1);
  return requireBoundedHolds(rows);
}

/**
 * The seats the session's open holds take at `at`, for the capacity editor and every later path
 * that moves spaces. Call it after the session row is locked, with a time read after the lock.
 */
export async function readOpenHeldSeats(
  tx: Transaction,
  sessionId: string,
  at: Date,
): Promise<number> {
  return openHeldSeats(await readOpenHolds(tx, sessionId, at), at);
}

type Placement =
  | { done: ReserveResult }
  | { soldOut: { experienceId: string; sessionId: string; seats: number } };

/**
 * Places a hold, in the order of design doc 4.2.3: parse, the ops switch, the device lock, the
 * session row lock, then the decisions at database time, taken after the lock wait. Every refusal
 * returns before the insert, so a refused request writes nothing. `sold_out` also leaves the
 * transaction, because other dates are looked up after the lock is gone.
 * TODO(U-014b): supersede the device's open `active` hold on this session, then the device limits.
 * TODO(U-086): the `hold_placed` event, in this transaction.
 */
export async function reserveSpaces(
  device: Device,
  input: ReserveSpacesInput,
): Promise<ReserveResult> {
  const parsed = ReserveInputSchema.safeParse(input);
  if (!parsed.success) return invalidFromIssues(parsed.error.issues);
  const request = parsed.data;
  const gift = giftRefusal(request.purpose);
  if (gift) return gift;

  const placement = await db.transaction(async (tx): Promise<Placement> => {
    const setting = await readHoldSettings(tx);
    const paused = pausedRefusal(setting.bookingsPaused);
    if (paused) return { done: paused };

    await lockDevice(tx, device.deviceKey);
    const locked = await lockSessionRow(tx, request.sessionId);
    const at = await readDatabaseTime(tx);
    const refusal = reserveRefusal(
      locked && {
        experienceStatus: locked.experienceStatus,
        sessionStatus: locked.session.status,
        startsAt: locked.session.startsAt,
      },
      at,
    );
    if (refusal || !locked) {
      return { done: refusal ?? unbookableSession };
    }

    const options = await tx
      .select({
        id: priceOptions.id,
        kind: priceOptions.kind,
        priceMinor: priceOptions.priceMinor,
        usesSpace: priceOptions.usesSpace,
      })
      .from(priceOptions)
      .where(eq(priceOptions.experienceId, locked.session.experienceId))
      .limit(MAX_LINES + 1);
    const party = partyFor(request.items, options);
    if (!party.ok) {
      return { done: { status: 'invalid', fieldErrors: party.fieldErrors } };
    }

    const left = spacesLeft(
      locked.session,
      await readOpenHolds(tx, locked.session.id, at),
      at,
    );
    if (!partyFits(party.seats, left)) {
      return {
        soldOut: {
          experienceId: locked.session.experienceId,
          sessionId: locked.session.id,
          seats: party.seats,
        },
      };
    }

    const priced = pricingLines(
      request.items,
      options,
      taxRatePpm(locked.taxTreatment, setting.taxRatePpm),
    );
    const expiresAt = holdExpiresAt(at, setting.holdMinutes);
    const [hold] = await tx
      .insert(holds)
      .values({
        sessionId: locked.session.id,
        purpose: request.purpose,
        status: 'active',
        seats: party.seats,
        deviceKey: device.deviceKey,
        ipHash: device.ipHash,
        expiresAt,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: holds.id });
    if (!hold) throw new Error('The hold insert returned no row');
    await tx.insert(holdItems).values(
      priced.lines.map((line) => ({
        holdId: hold.id,
        priceOptionId: line.priceOptionId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        usesSpace: line.usesSpace,
      })),
    );
    return {
      done: ReserveResultSchema.parse(
        heldResult({ id: hold.id, expiresAt }, priced),
      ),
    };
  });

  if ('done' in placement) return placement.done;
  return {
    status: 'sold_out',
    alternatives: await readAlternatives(placement.soldOut),
  };
}

/**
 * Other dates for a party that did not fit: read after the reserve transaction, with no lock, for
 * display only (a later reserve decides again under the lock). The candidates are bounded, and so
 * are their open holds.
 */
async function readAlternatives(request: {
  experienceId: string;
  sessionId: string;
  seats: number;
}): Promise<SessionSummary[]> {
  return db.transaction(async (tx) => {
    const at = await readDatabaseTime(tx);
    const window = alternativeWindow(at);
    const candidates = await tx
      .select({
        id: sessions.id,
        startsAt: sessions.startsAt,
        timeZone: sessions.timeZone,
        allocation: sessions.allocation,
        seatsSold: sessions.seatsSold,
        status: sessions.status,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.experienceId, request.experienceId),
          ne(sessions.id, request.sessionId),
          eq(sessions.status, 'scheduled'),
          gt(sessions.startsAt, window.from),
          lte(sessions.startsAt, window.until),
        ),
      )
      .orderBy(asc(sessions.startsAt))
      .limit(holdLimits.alternativeCandidates);
    if (candidates.length === 0) return [];
    const open = await tx
      .select(openHoldColumns)
      .from(holds)
      .where(
        and(
          inArray(
            holds.sessionId,
            candidates.map((candidate) => candidate.id),
          ),
          isOpenAt(at),
        ),
      )
      .limit(candidates.length * maxAllocation + 1);
    return pickAlternatives(
      candidates,
      requireBoundedHolds(open, candidates.length),
      request.seats,
      at,
    );
  });
}

/**
 * Ends an `active` hold early (design doc 4.2.1). The hold's session id is read with no lock, then
 * the session is locked, then the hold, and the hold is judged again under both. A missing hold,
 * another device's hold, and a converted one answer alike (`not_found`).
 */
export async function releaseHold(
  device: Device,
  input: ReleaseHoldInput,
): Promise<ReleaseResult> {
  const parsed = ReleaseInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'not_found' };
  const { holdId } = parsed.data;

  return db.transaction(async (tx): Promise<ReleaseResult> => {
    const [read] = await tx
      .select({ sessionId: holds.sessionId })
      .from(holds)
      .where(eq(holds.id, holdId));
    if (!read) return { status: 'not_found' };

    await lockSessionRow(tx, read.sessionId);
    const hold = await lockHoldRow(tx, holdId);
    const at = await readDatabaseTime(tx);
    const decision = decideRelease(hold ?? null, {
      deviceKey: device.deviceKey,
      sessionId: read.sessionId,
    });
    if (!decision.release) return decision.result;

    await tx
      .update(holds)
      .set({ status: 'released', releasedReason: 'guest_left', updatedAt: at })
      .where(eq(holds.id, holdId));
    return { status: 'released' };
  });
}
