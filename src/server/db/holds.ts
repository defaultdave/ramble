import 'server-only';
import { and, asc, eq, gt, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import { guestVisibleStatuses } from '@/lib/catalog';
import {
  ReleaseInputSchema,
  ReserveInputSchema,
  ReserveResultSchema,
  alternativeWindow,
  blockRefusal,
  blockWindowStart,
  decideRelease,
  exceptSuperseded,
  giftRefusal,
  heldResult,
  holdExpiresAt,
  holdLimits,
  holdsToRelease,
  holdsToSupersede,
  invalidFromIssues,
  openHeldSeats,
  partyFits,
  partyFor,
  pausedRefusal,
  pickAlternatives,
  requireAtMost,
  requireBoundedHolds,
  reserveRefusal,
  scrubCutoff,
  scrubbedHash,
  seatLimitRefusal,
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
import {
  revalidateTagsForChanges,
  updateTagsForChanges,
} from '@/server/cache/invalidate';
import type { Device } from '@/server/device';
import { db, dbRead, type Transaction } from './client';
import {
  lockClientAddress,
  lockDevice,
  lockHoldRow,
  lockSessionRow,
} from './locks';
import {
  experiences,
  holdItems,
  holds,
  priceOptions,
  sessions,
} from './schema';
import { readHoldSettings } from './settings';
import { currentDatabaseTime, readDatabaseTime } from './time';

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
  id: holds.id,
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

/** The holds of the same device, or from the same address: the limits count both (a device is a cookie the client can rotate). */
function sameClient(device: Device) {
  return or(
    eq(holds.deviceKey, device.deviceKey),
    eq(holds.ipHash, device.ipHash),
  );
}

/**
 * The device's open `active` holds on one session, locked (lock 3, after the session row) so the
 * decision sees each as it now stands. A device has at most `deviceSeatLimit` open holds, so one
 * row more than that proves the table is wrong.
 */
async function readSupersedeCandidates(
  tx: Transaction,
  sessionId: string,
  deviceKey: string,
  at: Date,
) {
  const rows = await tx
    .select({
      id: holds.id,
      deviceKey: holds.deviceKey,
      status: holds.status,
      expiresAt: holds.expiresAt,
      payingUntil: holds.payingUntil,
    })
    .from(holds)
    .where(
      and(
        eq(holds.sessionId, sessionId),
        eq(holds.deviceKey, deviceKey),
        eq(holds.status, 'active'),
        isOpenAt(at),
      ),
    )
    .orderBy(asc(holds.id))
    .for('update')
    .limit(holdLimits.deviceSeatLimit + 1);
  return requireAtMost(
    rows,
    holdLimits.deviceSeatLimit,
    'open holds for one device on one session',
  );
}

/**
 * The open holds of this device or address, in any session, besides the ones being superseded.
 * Each takes a seat, so a sixth row already fills the limit: the read stops at the limit plus the
 * rows that are about to leave, and the extra rows cannot change the answer.
 */
async function readOtherOpenHolds(
  tx: Transaction,
  device: Device,
  at: Date,
  superseded: readonly string[],
) {
  const rows = await tx
    .select(openHoldColumns)
    .from(holds)
    .where(and(sameClient(device), isOpenAt(at)))
    .limit(holdLimits.deviceSeatLimit + superseded.length);
  return exceptSuperseded(rows, superseded);
}

/**
 * The holds of this device or address that may have lapsed inside the block window, in any
 * session. A pre-filter on the columns (the deadline is somewhere inside the window); the lib
 * decides which of them are lapses. More rows than `blockScan` means the table is wrong.
 */
async function readRecentLapses(tx: Transaction, device: Device, at: Date) {
  const rows = await tx
    .select({
      status: holds.status,
      expiresAt: holds.expiresAt,
      payingUntil: holds.payingUntil,
      releasedReason: holds.releasedReason,
      updatedAt: holds.updatedAt,
    })
    .from(holds)
    .where(
      and(
        sameClient(device),
        sql`date_trunc('milliseconds', ${holds.expiresAt}) <= ${at}`,
        sql`date_trunc('milliseconds', greatest(${holds.expiresAt}, coalesce(${holds.payingUntil}, ${holds.expiresAt}))) > ${blockWindowStart(at)}`,
        or(
          inArray(holds.status, ['active', 'paying']),
          and(
            eq(holds.status, 'released'),
            inArray(holds.releasedReason, [
              'expired',
              'payment_abandoned',
              'guest_left',
            ]),
          ),
        ),
      ),
    )
    .limit(holdLimits.blockScan + 1);
  return requireAtMost(rows, holdLimits.blockScan, 'recent lapsed holds');
}

type Placement =
  | { done: ReserveResult }
  | { soldOut: { experienceId: string; sessionId: string; seats: number } };

/**
 * Places a hold, in the order of design doc 4.2.3: parse, the ops switch, the device lock, the
 * session row lock, then the decisions at database time, taken after the lock wait. Every refusal
 * returns before the insert, so a refused request writes nothing. `sold_out` also leaves the
 * transaction, because other dates are looked up after the lock is gone. The device's open `active`
 * hold on this session is superseded in the same transaction, after the block and the seat limit
 * and the spaces check have all said yes, so a refusal leaves the earlier hold standing. A hold
 * placed invalidates the session's spaces-left tag, so this runs in a Server Action only.
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
    await lockClientAddress(tx, device.ipHash);
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

    const superseded = holdsToSupersede(
      await readSupersedeCandidates(
        tx,
        locked.session.id,
        device.deviceKey,
        at,
      ),
      device.deviceKey,
      at,
    );
    const blocked = blockRefusal(await readRecentLapses(tx, device, at), at);
    if (blocked) return { done: blocked };
    const overLimit = seatLimitRefusal(
      await readOtherOpenHolds(tx, device, at, superseded),
      party.seats,
      at,
    );
    if (overLimit) return { done: overLimit };

    // The superseded hold's seats come back to this guest's new hold, so they do not count against it.
    const left = spacesLeft(
      locked.session,
      exceptSuperseded(
        await readOpenHolds(tx, locked.session.id, at),
        superseded,
      ),
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
    if (superseded.length > 0) {
      await tx
        .update(holds)
        .set({
          status: 'released',
          releasedReason: 'superseded',
          supersededBy: hold.id,
          updatedAt: at,
        })
        .where(inArray(holds.id, superseded));
    }
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

  if ('done' in placement) {
    if (placement.done.status === 'held') {
      updateTagsForChanges([{ kind: 'spaces', sessionId: request.sessionId }]);
    }
    return placement.done;
  }
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
 * another device's hold, and a converted one answer alike (`not_found`). A hold released here
 * invalidates the session's spaces-left tag, so this runs in a Server Action only.
 */
export async function releaseHold(
  device: Device,
  input: ReleaseHoldInput,
): Promise<ReleaseResult> {
  const parsed = ReleaseInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'not_found' };
  const { holdId } = parsed.data;

  const outcome = await db.transaction(
    async (
      tx,
    ): Promise<{ result: ReleaseResult; releasedSessionId?: string }> => {
      const [read] = await tx
        .select({ sessionId: holds.sessionId })
        .from(holds)
        .where(eq(holds.id, holdId));
      if (!read) return { result: { status: 'not_found' } };

      await lockSessionRow(tx, read.sessionId);
      const hold = await lockHoldRow(tx, holdId);
      const at = await readDatabaseTime(tx);
      const decision = decideRelease(hold ?? null, {
        deviceKey: device.deviceKey,
        sessionId: read.sessionId,
      });
      if (!decision.release) return { result: decision.result };

      await tx
        .update(holds)
        .set({
          status: 'released',
          releasedReason: 'guest_left',
          updatedAt: at,
        })
        .where(eq(holds.id, holdId));
      return {
        result: { status: 'released' },
        releasedSessionId: read.sessionId,
      };
    },
  );
  if (outcome.releasedSessionId) {
    updateTagsForChanges([
      { kind: 'spaces', sessionId: outcome.releasedSessionId },
    ]);
  }
  return outcome.result;
}

/** The SQL pre-filter for a hold past its deadline, at the same millisecond precision as `isOpenAt`. */
function isLapsedAt(at: Date) {
  return or(
    and(
      eq(holds.status, 'active'),
      sql`date_trunc('milliseconds', ${holds.expiresAt}) <= ${at}`,
    ),
    and(
      eq(holds.status, 'paying'),
      sql`date_trunc('milliseconds', ${holds.payingUntil}) <= ${at}`,
    ),
  );
}

/**
 * Releases lapsed holds, at most one batch of `cleanupBatch` per call, and returns how many. It
 * only tidies rows: a lapsed hold stopped counting at its deadline, so no guest-visible answer
 * depends on this running (design doc 4.2.3). The candidates are found with no lock, then each
 * session is locked in turn, as every path that starts from a hold does, and each hold is judged
 * again at database time under the lock. A hold that was converted, released, or extended in the
 * meantime is left alone, so a second run finds nothing to do.
 * TODO(U-106): a lapsed `paying` hold's live attempt is cancelled and its order voided in U-106's
 * step, which must run before this one in the pulse.
 */
export async function releaseLapsedHolds(): Promise<number> {
  const candidates = await db
    .select({ id: holds.id, sessionId: holds.sessionId })
    .from(holds)
    .where(isLapsedAt(await currentDatabaseTime()))
    .orderBy(asc(holds.expiresAt), asc(holds.id))
    .limit(holdLimits.cleanupBatch);
  const bySession = Map.groupBy(candidates, ({ sessionId }) => sessionId);

  let released = 0;
  for (const [sessionId, rows] of bySession) {
    const done = await db.transaction(async (tx) => {
      await lockSessionRow(tx, sessionId);
      const at = await readDatabaseTime(tx);
      const locked = await tx
        .select({
          id: holds.id,
          status: holds.status,
          expiresAt: holds.expiresAt,
          payingUntil: holds.payingUntil,
        })
        .from(holds)
        .where(
          and(
            eq(holds.sessionId, sessionId),
            inArray(
              holds.id,
              rows.map(({ id }) => id),
            ),
          ),
        )
        .orderBy(asc(holds.id))
        .for('update');
      const release = holdsToRelease(locked, at);
      let count = 0;
      for (const reason of ['expired', 'payment_abandoned'] as const) {
        const ids = release[reason];
        if (ids.length === 0) continue;
        await tx
          .update(holds)
          .set({ status: 'released', releasedReason: reason, updatedAt: at })
          .where(inArray(holds.id, ids));
        count += ids.length;
      }
      return count;
    });
    if (done > 0) {
      revalidateTagsForChanges([{ kind: 'spaces', sessionId }]);
      released += done;
    }
  }
  return released;
}

/**
 * Replaces the device and address hashes of released holds whose retention ended with a fixed
 * value, at most one batch per call, and returns how many. The PII inventory says released holds
 * go on a schedule; the rows are kept (hold items, `superseded_by`, and later orders point at them,
 * all with restricting foreign keys) and only the two identifying columns are cleared. Safe to run
 * twice: a scrubbed row no longer matches.
 */
export async function scrubReleasedHolds(): Promise<number> {
  const cutoff = scrubCutoff(await currentDatabaseTime());
  const due = await db
    .select({ id: holds.id })
    .from(holds)
    .where(
      and(
        eq(holds.status, 'released'),
        ne(holds.deviceKey, scrubbedHash),
        lt(holds.updatedAt, cutoff),
      ),
    )
    .orderBy(asc(holds.updatedAt), asc(holds.id))
    .limit(holdLimits.cleanupBatch);
  if (due.length === 0) return 0;
  const scrubbed = await db
    .update(holds)
    .set({ deviceKey: scrubbedHash, ipHash: scrubbedHash })
    .where(
      and(
        inArray(
          holds.id,
          due.map(({ id }) => id),
        ),
        eq(holds.status, 'released'),
      ),
    )
    .returning({ id: holds.id });
  return scrubbed.length;
}

/**
 * Spaces left in one session for display, or null when no session guests can see has this ID
 * (one answer for a missing session and a hidden experience). One statement joins the session to
 * its open holds, so the capacity and the holds come from the same snapshot, and the answer is
 * computed by `spacesLeft` as the reserve does. Read-only, on the HTTP handle: a reserve never
 * trusts it and always recomputes under the lock.
 */
export async function readSessionSpacesLeft(
  sessionId: string,
): Promise<number | null> {
  const at = await readDatabaseTime(dbRead);
  const rows = await dbRead
    .select({
      allocation: sessions.allocation,
      seatsSold: sessions.seatsSold,
      seats: holds.seats,
      status: holds.status,
      expiresAt: holds.expiresAt,
      payingUntil: holds.payingUntil,
    })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .leftJoin(holds, and(eq(holds.sessionId, sessions.id), isOpenAt(at)))
    .where(
      and(
        eq(sessions.id, sessionId),
        inArray(experiences.status, [...guestVisibleStatuses]),
      ),
    )
    .limit(maxAllocation + 1);
  const [first] = requireBoundedHolds(rows);
  if (!first) return null;
  const open = rows.flatMap((row) =>
    row.seats !== null && row.status !== null && row.expiresAt !== null
      ? [
          {
            seats: row.seats,
            status: row.status,
            expiresAt: row.expiresAt,
            payingUntil: row.payingUntil,
          },
        ]
      : [],
  );
  return spacesLeft(first, open, at);
}
