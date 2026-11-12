import 'server-only';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import {
  HostWeekSessionSchema,
  addDays,
  resolveWeek,
  weekBounds,
  weekStartOf,
  type HostWeekData,
} from '@/lib/hostSessions';
import {
  AddOneOffSessionInputSchema,
  CancelSessionInputSchema,
  GenerateSessionsInputSchema,
  IsoDateSchema,
  SessionSchema,
  SessionTemplateInputSchema,
  SessionTemplateSchema,
  UpdateSessionAllocationInputSchema,
  UpdateSessionPriceInputSchema,
  UpdateSessionTimeInputSchema,
  checkAllocationChange,
  checkAllocationEditable,
  checkExpectedVersion,
  checkUnbooked,
  countAlreadyExisted,
  isBeyondHorizon,
  isUpcoming,
  localDateIn,
  occurrenceOn,
  occurrencesBetween,
  requiresStaff,
  resolveHostZone,
  rollingRange,
  splitUpcoming,
  type AddOneOffSessionInput,
  type CancelSessionInput,
  type GenerateSessionsInput,
  type Session,
  type SessionTemplate,
  type SessionTemplateInput,
  type UpdateSessionAllocationInput,
  type UpdateSessionPriceInput,
  type UpdateSessionTimeInput,
} from '@/lib/sessions';
import { errorKind } from '@/lib/errorKind';
import {
  ForbiddenError,
  Role,
  requireRole,
  type Caller,
} from '@/server/auth/caller';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import { sessionAllocationChangedEntry } from '@/lib/sessionAudit';
import { writeAudit } from './audit';
import { db, type Transaction } from './client';
import { readOpenHeldSeats } from './holds';
import { lockSessionRow } from './locks';
import {
  experiences,
  hosts,
  priceOptions,
  sessionTemplates,
  sessions,
} from './schema';
import { readDatabaseTime } from './time';
import { systemClock } from '@/server/ports/clock';

type Source = Session['source'];

function isStaff(caller: Caller): boolean {
  return caller.roles.includes(Role.Ops) || caller.roles.includes(Role.Admin);
}

/**
 * Every refusal of a caller who is not staff names the host owner role, whatever the reason, so a
 * missing row, another host's row and a staff-only row cannot be told apart.
 */
function refuse(): never {
  throw new ForbiddenError(Role.HostOwner);
}

/** Called when a row is not there. Staff may learn that; anyone else is refused. */
function refuseUnlessStaff(caller: Caller) {
  if (!isStaff(caller)) refuse();
}

/** Ops and admin may act on any host's sessions. A host owner may act on their own Ramble-sourced capacity. */
function requireSessionEditor(caller: Caller, hostId: string, source: Source) {
  if (isStaff(caller)) return;
  if (requiresStaff(source)) refuse();
  requireRole(caller, Role.HostOwner, { hostId });
}

export type CreateSessionTemplateResult =
  | { ok: true; template: SessionTemplate }
  | { ok: false; reason: 'experience_not_found' | 'duplicate_slot' };

/**
 * Adds a weekly slot to an experience. An allocation template is set up by ops; a Ramble template
 * by the experience's host owner or ops. The slot (weekday and start time) is unique per experience.
 * `executor` is a transaction when the slot is one of several changes that stand or fall together.
 */
export async function createSessionTemplate(
  caller: Caller,
  input: SessionTemplateInput,
  executor: Executor = db,
): Promise<CreateSessionTemplateResult> {
  const data = SessionTemplateInputSchema.parse(input);
  const [experience] = await executor
    .select({ hostId: experiences.hostId })
    .from(experiences)
    .where(eq(experiences.id, data.experienceId));
  if (!experience) {
    refuseUnlessStaff(caller);
    return { ok: false, reason: 'experience_not_found' };
  }
  requireSessionEditor(caller, experience.hostId, data.source);
  const [row] = await executor
    .insert(sessionTemplates)
    .values(data)
    .onConflictDoNothing({
      target: [
        sessionTemplates.experienceId,
        sessionTemplates.weekday,
        sessionTemplates.startTime,
      ],
    })
    .returning();
  return row
    ? { ok: true, template: SessionTemplateSchema.parse(row) }
    : { ok: false, reason: 'duplicate_slot' };
}

export type GenerateSessionsResult =
  | {
      ok: true;
      /** For `tagsForChanges([{ kind: 'experience', experienceId }])` in the calling action or job. */
      experienceId: string;
      created: Session[];
      alreadyExisted: number;
      /** Dates in the range whose start is not after `now`. */
      inThePast: number;
    }
  | {
      ok: false;
      reason: 'template_not_found' | 'invalid_time_zone' | 'beyond_horizon';
    };

/**
 * Creates the template's sessions for the dates from `fromDate` to `toDate` in the host's time zone,
 * and is safe to run again over the same or an overlapping range: a date that already has a session
 * is left as it is, so an edited or cancelled session is never rebuilt. A date whose start is not
 * after `now` is skipped. The range is limited to `maxGenerationDays`, and a `toDate` past
 * `generationHorizon(now)` (see `isBeyondHorizon`) is refused with nothing written.
 */
export async function generateSessions(
  caller: Caller,
  input: GenerateSessionsInput,
  now: Date,
): Promise<GenerateSessionsResult> {
  return generateSessionsIn(db, caller, input, now);
}

/** Where a generation reads and writes: the pool, or a transaction that wants several templates done together. */
type Executor = Pick<Transaction, 'select' | 'insert'>;

export async function generateSessionsIn(
  executor: Executor,
  caller: Caller,
  input: GenerateSessionsInput,
  now: Date,
): Promise<GenerateSessionsResult> {
  const data = GenerateSessionsInputSchema.parse(input);
  const [row] = await executor
    .select({
      template: sessionTemplates,
      hostId: hosts.id,
      timeZone: hosts.timeZone,
    })
    .from(sessionTemplates)
    .innerJoin(experiences, eq(experiences.id, sessionTemplates.experienceId))
    .innerJoin(hosts, eq(hosts.id, experiences.hostId))
    .where(eq(sessionTemplates.id, data.templateId));
  if (!row) {
    refuseUnlessStaff(caller);
    return { ok: false, reason: 'template_not_found' };
  }
  const template = SessionTemplateSchema.parse(row.template);
  requireSessionEditor(caller, row.hostId, template.source);

  if (isBeyondHorizon(data.toDate, now)) {
    return { ok: false, reason: 'beyond_horizon' };
  }

  const hostZone = resolveHostZone(row.timeZone);
  if (!hostZone.ok) return hostZone;
  const zone = hostZone.zone;

  const occurrences = occurrencesBetween(
    template,
    zone,
    data.fromDate,
    data.toDate,
  );
  const { upcoming, inThePast } = splitUpcoming(occurrences, now);
  if (upcoming.length === 0) {
    return {
      ok: true,
      experienceId: template.experienceId,
      created: [],
      alreadyExisted: 0,
      inThePast,
    };
  }

  const inserted = await executor
    .insert(sessions)
    .values(
      upcoming.map((occurrence) => ({
        experienceId: template.experienceId,
        templateId: template.id,
        localDate: occurrence.localDate,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        timeZone: zone,
        allocation: template.allocation,
        source: template.source,
      })),
    )
    .onConflictDoNothing({
      target: [sessions.templateId, sessions.localDate],
    })
    .returning();
  return {
    ok: true,
    experienceId: template.experienceId,
    created: SessionSchema.array().parse(inserted),
    alreadyExisted: countAlreadyExisted(upcoming.length, inserted.length),
    inThePast,
  };
}

export type UpdateSessionAllocationResult =
  | { ok: true; session: Session }
  | {
      ok: false;
      reason:
        | 'session_not_found'
        | 'not_scheduled'
        | 'version_conflict'
        | 'in_the_past'
        | 'below_sold_and_held';
      seatsSold?: number;
      heldSeats?: number;
    };

/**
 * Sets a scheduled session's capacity. The caller is checked before the row is locked. Under the
 * lock the row is read again, so a booking that confirms at the same moment is counted, and so
 * are the open holds, judged at database time taken after the lock. The database CHECK on
 * `seats_sold` stays the backstop under it. A saved edit invalidates the session's spaces-left tag,
 * so this runs in a Server Action only.
 * `expectedVersion` is the version the editor read; a different one means another edit came first.
 * The audit row is written in the same transaction, so a capacity is never changed unrecorded.
 * A session that has started (its start is not after `now`) is left as it is.
 */
export async function updateSessionAllocation(
  caller: Caller,
  input: UpdateSessionAllocationInput,
  now: Date = systemClock.now(),
): Promise<UpdateSessionAllocationResult> {
  const data = UpdateSessionAllocationInputSchema.parse(input);
  const [found] = await db
    .select({ source: sessions.source, hostId: experiences.hostId })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .where(eq(sessions.id, data.sessionId));
  if (!found) {
    refuseUnlessStaff(caller);
    return { ok: false, reason: 'session_not_found' };
  }
  requireSessionEditor(caller, found.hostId, found.source);

  const result = await db.transaction(
    async (tx): Promise<UpdateSessionAllocationResult> => {
      const row = await lockSessionRow(tx, data.sessionId);
      if (!row) return { ok: false, reason: 'session_not_found' };
      const current = SessionSchema.parse(row.session);
      requireSessionEditor(caller, row.hostId, current.source);
      const editable = checkAllocationEditable(current.status);
      if (!editable.ok) return editable;
      const version = checkExpectedVersion(
        current.version,
        data.expectedVersion,
      );
      if (!version.ok) return version;
      if (!isUpcoming(current.startsAt, now)) {
        return { ok: false, reason: 'in_the_past' };
      }
      const heldSeats = await readOpenHeldSeats(
        tx,
        current.id,
        await readDatabaseTime(tx),
      );
      const check = checkAllocationChange(
        current.seatsSold,
        heldSeats,
        data.allocation,
      );
      if (!check.ok) return check;
      const [updated] = await tx
        .update(sessions)
        .set({
          allocation: data.allocation,
          version: sql`${sessions.version} + 1`,
        })
        .where(eq(sessions.id, current.id))
        .returning();
      await writeAudit(
        tx,
        sessionAllocationChangedEntry({
          userId: caller.userId,
          sessionId: current.id,
          from: current.allocation,
          to: data.allocation,
        }),
      );
      return { ok: true, session: SessionSchema.parse(updated) };
    },
  );
  if (result.ok) {
    updateTagsForChanges([{ kind: 'spaces', sessionId: result.session.id }]);
  }
  return result;
}

export type ChangeSessionResult =
  | { ok: true; session: Session }
  | {
      ok: false;
      reason:
        | 'session_not_found'
        | 'not_scheduled'
        | 'version_conflict'
        | 'in_the_past'
        | 'has_bookings'
        | 'has_holds';
    };

type SessionChange =
  | { ok: true; set: Partial<typeof sessions.$inferInsert> }
  | { ok: false; reason: 'in_the_past' };

/**
 * The shared path of a change that needs a session nobody has a claim on: the caller is checked,
 * then under the row lock the status, the version, the start (a started session is left alone),
 * the seats sold and the open holds are judged, and only then is `plan`'s change written. Cache tags
 * are invalidated, so this runs in a Server Action only.
 */
async function changeUnbookedSession(
  caller: Caller,
  input: { sessionId: string; expectedVersion: number },
  now: Date,
  plan: (current: Session) => SessionChange,
): Promise<ChangeSessionResult> {
  const [found] = await db
    .select({ source: sessions.source, hostId: experiences.hostId })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .where(eq(sessions.id, input.sessionId));
  if (!found) {
    refuseUnlessStaff(caller);
    return { ok: false, reason: 'session_not_found' };
  }
  requireSessionEditor(caller, found.hostId, found.source);

  const result = await db.transaction(
    async (tx): Promise<ChangeSessionResult> => {
      const row = await lockSessionRow(tx, input.sessionId);
      if (!row) return { ok: false, reason: 'session_not_found' };
      const current = SessionSchema.parse(row.session);
      requireSessionEditor(caller, row.hostId, current.source);
      const editable = checkAllocationEditable(current.status);
      if (!editable.ok) return editable;
      const version = checkExpectedVersion(
        current.version,
        input.expectedVersion,
      );
      if (!version.ok) return version;
      if (!isUpcoming(current.startsAt, now)) {
        return { ok: false, reason: 'in_the_past' };
      }
      const heldSeats = await readOpenHeldSeats(
        tx,
        current.id,
        await readDatabaseTime(tx),
      );
      const unbooked = checkUnbooked(current.seatsSold, heldSeats);
      if (!unbooked.ok) return { ok: false, reason: unbooked.reason };
      const change = plan(current);
      if (!change.ok) return change;
      const [updated] = await tx
        .update(sessions)
        .set({ ...change.set, version: sql`${sessions.version} + 1` })
        .where(eq(sessions.id, current.id))
        .returning();
      return { ok: true, session: SessionSchema.parse(updated) };
    },
  );
  if (result.ok) {
    updateTagsForChanges([
      { kind: 'experience', experienceId: result.session.experienceId },
      { kind: 'spaces', sessionId: result.session.id },
    ]);
  }
  return result;
}

/**
 * Moves a session to another start time and length on its own date. Only a session with no seats
 * sold and no open hold moves (PRD-41: a booked session's time change is the cancellation flow). The
 * date stays, so a templated session keeps the date that names it and the rolling job never builds
 * it again. The new start must be after `now`.
 */
export async function updateSessionTime(
  caller: Caller,
  input: UpdateSessionTimeInput,
  now: Date,
): Promise<ChangeSessionResult> {
  const data = UpdateSessionTimeInputSchema.parse(input);
  return changeUnbookedSession(caller, data, now, (current) => {
    const occurrence = occurrenceOn(
      current.localDate ?? localDateIn(current.startsAt, current.timeZone),
      data.startTime,
      data.durationMinutes,
      current.timeZone,
    );
    return isUpcoming(occurrence.startsAt, now)
      ? {
          ok: true,
          set: { startsAt: occurrence.startsAt, endsAt: occurrence.endsAt },
        }
      : { ok: false, reason: 'in_the_past' };
  });
}

/**
 * Cancels a session with no seats sold and no open hold, as the host's own cancellation. The row
 * stays with its template and date, so the rolling job does not rebuild it. A booked session is not
 * cancelled here: that is the refund flow.
 */
export async function cancelUnbookedSession(
  caller: Caller,
  input: CancelSessionInput,
  now: Date,
): Promise<ChangeSessionResult> {
  const data = CancelSessionInputSchema.parse(input);
  return changeUnbookedSession(caller, data, now, () => ({
    ok: true,
    set: { status: 'cancelled', cancelReason: 'host' },
  }));
}

export type UpdateSessionPriceResult =
  | { ok: true; priceMinor: number }
  | {
      ok: false;
      reason:
        'session_not_found' | 'not_scheduled' | 'in_the_past' | 'no_such_price';
    };

/**
 * Sets the price of one kind for the experience of the session the form was posted from. Prices
 * belong to the experience, so every one of its sessions sells at the new price from now on; a hold
 * and an order keep the price they were made at, so only new bookings pay it (PRD-41). The posted
 * session gates the edit: it must be the caller's to edit, scheduled, and not started, so a form
 * left open on a cancelled or past session changes nothing. The caller is checked before the row is
 * locked and again under the lock.
 */
export async function updateSessionPrice(
  caller: Caller,
  input: UpdateSessionPriceInput,
  now: Date,
): Promise<UpdateSessionPriceResult> {
  const data = UpdateSessionPriceInputSchema.parse(input);
  const [found] = await db
    .select({
      source: sessions.source,
      hostId: experiences.hostId,
      experienceId: sessions.experienceId,
    })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .where(eq(sessions.id, data.sessionId));
  if (!found) {
    refuseUnlessStaff(caller);
    return { ok: false, reason: 'session_not_found' };
  }
  requireSessionEditor(caller, found.hostId, found.source);

  const result = await db.transaction(
    async (tx): Promise<UpdateSessionPriceResult> => {
      const row = await lockSessionRow(tx, data.sessionId);
      if (!row) return { ok: false, reason: 'session_not_found' };
      const current = SessionSchema.parse(row.session);
      requireSessionEditor(caller, row.hostId, current.source);
      const editable = checkAllocationEditable(current.status);
      if (!editable.ok) return editable;
      if (!isUpcoming(current.startsAt, now)) {
        return { ok: false, reason: 'in_the_past' };
      }
      const [updated] = await tx
        .update(priceOptions)
        .set({ priceMinor: data.priceMinor })
        .where(
          and(
            eq(priceOptions.experienceId, current.experienceId),
            eq(priceOptions.kind, data.kind),
          ),
        )
        .returning({ priceMinor: priceOptions.priceMinor });
      return updated
        ? { ok: true, priceMinor: updated.priceMinor }
        : { ok: false, reason: 'no_such_price' };
    },
  );
  if (result.ok) {
    updateTagsForChanges([
      { kind: 'experience', experienceId: found.experienceId },
    ]);
  }
  return result;
}

export type AddOneOffSessionResult =
  | { ok: true; session: Session }
  | {
      ok: false;
      reason:
        | 'experience_not_found'
        | 'invalid_time_zone'
        | 'beyond_horizon'
        | 'in_the_past';
    };

/**
 * Adds one dated session of the host's own capacity, with no template, on a date and time in the
 * host's zone. The start must be after `now` and inside the generation horizon.
 */
export async function addOneOffSession(
  caller: Caller,
  input: AddOneOffSessionInput,
  now: Date,
): Promise<AddOneOffSessionResult> {
  const data = AddOneOffSessionInputSchema.parse(input);
  const [experience] = await db
    .select({ hostId: experiences.hostId, timeZone: hosts.timeZone })
    .from(experiences)
    .innerJoin(hosts, eq(hosts.id, experiences.hostId))
    .where(eq(experiences.id, data.experienceId));
  if (!experience) {
    refuseUnlessStaff(caller);
    return { ok: false, reason: 'experience_not_found' };
  }
  requireSessionEditor(caller, experience.hostId, 'ramble');
  const hostZone = resolveHostZone(experience.timeZone);
  if (!hostZone.ok) return hostZone;
  if (isBeyondHorizon(data.localDate, now)) {
    return { ok: false, reason: 'beyond_horizon' };
  }
  const occurrence = occurrenceOn(
    data.localDate,
    data.startTime,
    data.durationMinutes,
    hostZone.zone,
  );
  if (!isUpcoming(occurrence.startsAt, now)) {
    return { ok: false, reason: 'in_the_past' };
  }
  const [inserted] = await db
    .insert(sessions)
    .values({
      experienceId: data.experienceId,
      templateId: null,
      localDate: null,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      timeZone: hostZone.zone,
      allocation: data.allocation,
      source: 'ramble',
    })
    .returning();
  updateTagsForChanges([
    { kind: 'experience', experienceId: data.experienceId },
  ]);
  return { ok: true, session: SessionSchema.parse(inserted) };
}

/** Publishing a week stopped for a reason the host can act on; thrown inside the transaction so every slot rolls back. */
class WeekNotPublished extends Error {
  constructor(readonly reason: 'invalid_time_zone') {
    super(`The week was not published: ${reason}`);
    this.name = 'WeekNotPublished';
  }
}

export type PublishWeekResult =
  | {
      ok: true;
      /** The host's weekly slots that were run over the week. */
      templates: number;
      created: number;
      alreadyExisted: number;
      inThePast: number;
    }
  | { ok: false; reason: 'beyond_horizon' | 'invalid_time_zone' };

/**
 * Publishes a week from the host's weekly slots. A session exists, and is bookable, as soon as it
 * is generated, so publishing is generating: every Ramble-sourced slot of the host is run over the
 * week's dates (Monday to Sunday of the week `weekDate` falls in), and what the rolling job already
 * made is left as it is, edited or cancelled. A slot an allocation set up is ops's and is not
 * touched. Only the host's owner may publish, for their own host.
 */
export async function publishWeek(
  caller: Caller,
  hostId: string,
  weekDate: string,
  now: Date,
): Promise<PublishWeekResult> {
  const id = EntityIdSchema.parse(hostId);
  const fromDate = weekStartOf(IsoDateSchema.parse(weekDate));
  const toDate = addDays(fromDate, 6);
  requireRole(caller, Role.HostOwner, { hostId: id });
  if (isBeyondHorizon(toDate, now))
    return { ok: false, reason: 'beyond_horizon' };

  const published = await db
    .transaction(async (tx) => {
      const slots = await tx
        .select({ id: sessionTemplates.id })
        .from(sessionTemplates)
        .innerJoin(
          experiences,
          eq(experiences.id, sessionTemplates.experienceId),
        )
        .where(
          and(
            eq(experiences.hostId, id),
            eq(sessionTemplates.source, 'ramble'),
          ),
        )
        .orderBy(experiences.id, sessionTemplates.id);
      const total = { created: 0, alreadyExisted: 0, inThePast: 0 };
      const grown = new Set<string>();
      for (const slot of slots) {
        const result = await generateSessionsIn(
          tx,
          caller,
          { templateId: slot.id, fromDate, toDate },
          now,
        );
        if (!result.ok) {
          // A zone the host must fix is reported. The rest cannot happen here: the slot was read a
          // moment ago, and the horizon was checked above.
          if (result.reason === 'invalid_time_zone') {
            throw new WeekNotPublished(result.reason);
          }
          throw new Error(`Publishing a week was refused: ${result.reason}`);
        }
        total.created += result.created.length;
        total.alreadyExisted += result.alreadyExisted;
        total.inThePast += result.inThePast;
        if (result.created.length > 0) grown.add(result.experienceId);
      }
      return { templates: slots.length, grown: [...grown], ...total };
    })
    .catch((error: unknown) => {
      if (error instanceof WeekNotPublished) return error;
      throw error;
    });
  if (published instanceof WeekNotPublished) {
    return { ok: false, reason: published.reason };
  }
  // After the commit, so a week that rolled back invalidates nothing.
  updateTagsForChanges(
    published.grown.map((experienceId) => ({
      kind: 'experience',
      experienceId,
    })),
  );
  return {
    ok: true,
    templates: published.templates,
    created: published.created,
    alreadyExisted: published.alreadyExisted,
    inThePast: published.inThePast,
  };
}

/**
 * The host's sessions for one week, with the experiences a one-off date can be added to. The
 * caller is checked against `hostId` before anything is read, and every query is cut to that host.
 * `rawWeek` is the address's `week`; a week outside the limits reads as this one. Null when no such
 * host exists.
 */
export async function readHostWeek(
  caller: Caller,
  hostId: string,
  rawWeek: string | undefined,
  now: Date,
): Promise<HostWeekData | null> {
  const id = EntityIdSchema.parse(hostId);
  requireRole(caller, Role.HostOwner, { hostId: id });
  const [host] = await db
    .select({ name: hosts.name, timeZone: hosts.timeZone })
    .from(hosts)
    .where(eq(hosts.id, id));
  if (!host) return null;
  const hostZone = resolveHostZone(host.timeZone);
  if (!hostZone.ok) throw new RangeError('The host time zone is not usable');
  const weekStart = resolveWeek(rawWeek, now, hostZone.zone);
  const { from, to } = weekBounds(weekStart, hostZone.zone);
  const [rows, owned] = await Promise.all([
    db
      .select({
        id: sessions.id,
        experienceName: experiences.name,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        timeZone: sessions.timeZone,
        allocation: sessions.allocation,
        seatsSold: sessions.seatsSold,
        status: sessions.status,
        version: sessions.version,
        adultPriceMinor: priceOptions.priceMinor,
      })
      .from(sessions)
      .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
      .leftJoin(
        priceOptions,
        and(
          eq(priceOptions.experienceId, sessions.experienceId),
          eq(priceOptions.kind, 'adult'),
        ),
      )
      .where(
        and(
          eq(experiences.hostId, id),
          gte(sessions.startsAt, from),
          lt(sessions.startsAt, to),
        ),
      )
      .orderBy(asc(sessions.startsAt), asc(sessions.id)),
    db
      .select({ id: experiences.id, name: experiences.name })
      .from(experiences)
      .where(eq(experiences.hostId, id))
      .orderBy(asc(experiences.name), asc(experiences.id)),
  ]);
  return {
    hostName: host.name,
    timeZone: hostZone.zone,
    weekStart,
    experiences: owned,
    sessions: HostWeekSessionSchema.array().parse(rows),
  };
}

/** The pulse acts for no one in particular and for every host's templates, so it carries ops. */
const pulseCaller: Caller = { userId: null, roles: [Role.Ops], hostIds: [] };

export type ExtendHorizonResult = {
  created: number;
  /** Experiences that gained a session, for `revalidateTagsForChanges` in the job. */
  experienceIds: string[];
  /** Templates whose host zone is unusable; they are left alone and the rest carry on. */
  skipped: number;
  /** Templates whose generation threw; the rest were still done. */
  failed: number;
  /** The error name of the first failure, never its message, or null when none failed. */
  firstErrorName: string | null;
};

type GenerateForTemplate = (
  templateId: string,
  range: { fromDate: string; toDate: string },
  now: Date,
) => Promise<GenerateSessionsResult>;

const generateAsPulse: GenerateForTemplate = (templateId, range, now) =>
  generateSessions(pulseCaller, { templateId, ...range }, now);

/**
 * Keeps every template's sessions generated up to `rollingHorizonWeeks` ahead of `now`, by running
 * `generateSessions` over `rollingRange(now)` for each. Safe to run twice: a date that already has
 * a session is left as it is, so a second run creates nothing. Not tied to a request, so it takes no
 * caller from one. A template that throws is counted in `failed` and the next one still runs, so
 * one bad template neither loses the others' results nor starves the templates after it.
 * `generate` is the seam a test uses to make one template throw.
 */
export async function extendSessionHorizon(
  now: Date,
  generate: GenerateForTemplate = generateAsPulse,
): Promise<ExtendHorizonResult> {
  const range = rollingRange(now);
  const templates = await db
    .select({ id: sessionTemplates.id })
    .from(sessionTemplates)
    .orderBy(sessionTemplates.id);
  const experienceIds = new Set<string>();
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let firstErrorName: string | null = null;
  for (const { id } of templates) {
    try {
      const result = await generate(id, range, now);
      if (!result.ok) {
        skipped += 1;
      } else if (result.created.length > 0) {
        created += result.created.length;
        experienceIds.add(result.experienceId);
      }
    } catch (error) {
      failed += 1;
      firstErrorName ??= errorKind(error, 'NonError');
    }
  }
  return {
    created,
    experienceIds: [...experienceIds],
    skipped,
    failed,
    firstErrorName,
  };
}
